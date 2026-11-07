import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { Pool } from 'pg';
import type { AiServiceClient } from './ai-client.js';
import { HttpAiServiceClient } from './ai-client.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { RunExecutor } from './executor.js';
import { EvaluationExecutor } from './evaluation-executor.js';
import { registerMilestone2Routes } from './milestone2-routes.js';
import { registerApiRoutes } from './routes.js';
import { PostgresStore, type Store } from './store.js';

export interface Dependencies {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
  aiClient: AiServiceClient;
  store: Store;
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
    store: new PostgresStore(pool),
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
  await app.register(cors, { origin: true });

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

  const executor = new RunExecutor(dependencies.store, dependencies.aiClient, {
    info: (data, message) => app.log.info(data, message),
    error: (data, message) => app.log.error(data, message),
  });
  const evaluationExecutor = new EvaluationExecutor(dependencies.store, executor, {
    info: (data, message) => app.log.info(data, message),
    error: (data, message) => app.log.error(data, message),
  });
  await registerApiRoutes(app, dependencies.store, executor);
  await registerMilestone2Routes(app, dependencies.store, evaluationExecutor);
  app.addHook('onClose', async () => dependencies.close());
  return app;
};
