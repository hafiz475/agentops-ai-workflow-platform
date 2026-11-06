import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

export const migrateDatabase = async (connectionString: string): Promise<void> => {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const directory = path.join(process.cwd(), 'apps', 'api', 'migrations');
    const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', [
        version,
      ]);
      if (applied.rowCount) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',
          [version],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
};
