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
import { BullDurableQueue, type DurableQueue } from './queue.js';

export interface Dependencies {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
  aiClient: AiServiceClient;
  store: Store;
  queue?: DurableQueue;
  close(): Promise<void>;
}

const createDependencies = (config: Config): Dependencies => {
  const pool = new Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 2_000 });
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const queue = new BullDurableQueue(config.REDIS_URL);
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
    queue,
    async close() {
      await Promise.all([pool.end(), redis.quit().catch(() => undefined), queue.close()]);
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
  const queue: DurableQueue = dependencies.queue ?? {
    async enqueueRun(runId: string) {
      const run = await dependencies.store.getRunById(runId);
      if (run) {
        const version = await dependencies.store.getVersion(
          run.projectId,
          run.workflowId,
          run.workflowVersionId,
        );
        if (version) setImmediate(() => void executor.execute(run, version));
      }
      return `test-run-${runId}`;
    },
    async enqueueEvaluation(evaluationRunId: string) {
      const run = await dependencies.store.getEvaluationRunById(evaluationRunId);
      if (run) {
        const cases = await dependencies.store.listEvaluationCases(run.projectId, run.datasetId);
        const version = await dependencies.store.getVersion(
          run.projectId,
          run.workflowId,
          run.workflowVersionId,
        );
        if (version) setImmediate(() => void evaluationExecutor.execute(run, cases, version));
      }
      return `test-evaluation-${evaluationRunId}`;
    },
    async removeRun() {},
    async close() {},
  };
  const evaluationExecutor = new EvaluationExecutor(dependencies.store, queue, {
    info: (data, message) => app.log.info(data, message),
    error: (data, message) => app.log.error(data, message),
  });
  await registerApiRoutes(app, dependencies.store, queue);
  await registerMilestone2Routes(app, dependencies.store, queue);
  app.addHook('onClose', async () => dependencies.close());
  return app;
};
