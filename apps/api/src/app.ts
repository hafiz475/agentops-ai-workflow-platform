import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { Pool } from 'pg';
import type { AiServiceClient } from './ai-client.js';
import { HttpAiServiceClient } from './ai-client.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';

export interface Dependencies {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
  aiClient: AiServiceClient;
  close(): Promise<void>;
}

const createDependencies = (config: Config): Dependencies => {
  const pool = new Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 2_000 });
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return {
    async checkPostgres() {
      await pool.query('SELECT 1');
    },
    async checkRedis() {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    },
    aiClient: new HttpAiServiceClient(config.AI_SERVICE_URL),
    async close() {
      await Promise.all([pool.end(), redis.quit().catch(() => undefined)]);
    },
  };
};

export const buildApp = async (
  config: Config = loadConfig(),
  dependencies: Dependencies = createDependencies(config),
): Promise<FastifyInstance> => {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: false });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'control-plane-api',
    version: '0.1.0',
  }));
  app.get('/ready', async (_request, reply) => {
    try {
      await Promise.all([
        dependencies.checkPostgres(),
        dependencies.checkRedis(),
        dependencies.aiClient.ready(),
      ]);
      return { status: 'ok', service: 'control-plane-api', version: '0.1.0' };
    } catch (error) {
      app.log.warn({ error }, 'readiness dependency failed');
      return reply.code(503).send({ status: 'unavailable', service: 'control-plane-api' });
    }
  });

  app.addHook('onClose', async () => dependencies.close());
  return app;
};
