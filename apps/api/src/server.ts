import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrateDatabase } from './migrate.js';

const config = loadConfig();
await migrateDatabase(config.DATABASE_URL);
const app = await buildApp(config);

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
