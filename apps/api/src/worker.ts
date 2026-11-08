import { Worker, type Job } from 'bullmq';
import { Pool } from 'pg';
import { HttpAiServiceClient } from './ai-client.js';
import { loadConfig } from './config.js';
import { RunExecutor, TransientExecutionError } from './executor.js';
import { EvaluationExecutor } from './evaluation-executor.js';
import {
  BullDurableQueue,
  RUN_QUEUE_NAME,
  EVALUATION_QUEUE_NAME,
  type RunJobData,
  type EvaluationJobData,
  queueConnection,
} from './queue.js';
import { PostgresStore } from './store.js';

const config = loadConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL });
const store = new PostgresStore(pool);
const producer = new BullDurableQueue(config.REDIS_URL);
const log = (level: 'info' | 'error', data: Record<string, unknown>, message: string) =>
  console[level](JSON.stringify({ level, message, ...data, timestamp: new Date().toISOString() }));
const executor = new RunExecutor(store, new HttpAiServiceClient(config.AI_SERVICE_URL), {
  info: (data, message) => log('info', data, message),
  error: (data, message) => log('error', data, message),
});

const worker = new Worker<RunJobData>(
  RUN_QUEUE_NAME,
  async (job: Job<RunJobData>) => {
    const run = await store.getRunById(job.data.runId);
    if (!run) throw new Error(`Run ${job.data.runId} does not exist.`);
    const version = await store.getVersion(run.projectId, run.workflowId, run.workflowVersionId);
    if (!version)
      throw new Error(
        `WorkflowVersion ${run.workflowVersionId} does not exist in the run project.`,
      );
    const attempt = job.attemptsMade + 1;
    await store.updateRun(run.id, {
      attemptCount: attempt,
      lastAttemptAt: new Date().toISOString(),
      queueJobId: String(job.id),
    });
    await store.addTrace({
      runId: run.id,
      nodeRunId: null,
      eventType: 'WORKER_CLAIMED_RUN',
      metadata: { job_id: job.id, attempt },
    });
    log(
      'info',
      {
        project_id: run.projectId,
        workflow_id: run.workflowId,
        workflow_version_id: run.workflowVersionId,
        run_id: run.id,
        job_id: job.id,
        attempt,
      },
      'worker.job_received',
    );
    try {
      return await executor.execute(run, version);
    } catch (error) {
      if (error instanceof TransientExecutionError && attempt < run.maxAttempts) {
        await store.updateRun(run.id, {
          status: 'QUEUED',
          errorCode: 'TRANSIENT_FAILURE',
          errorMessage: error.message,
        });
        await store.addTrace({
          runId: run.id,
          nodeRunId: null,
          eventType: 'RUN_RETRY_SCHEDULED',
          metadata: { attempt, next_attempt: attempt + 1 },
        });
        log('info', { run_id: run.id, job_id: job.id, attempt }, 'worker.retry_scheduled');
        throw error;
      }
      await store.updateRun(run.id, {
        status: 'FAILED',
        errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        errorMessage: error instanceof Error ? error.message : 'Execution failed.',
        completedAt: new Date().toISOString(),
      });
      await store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: 'RUN_FAILED',
        metadata: { code: 'MAX_ATTEMPTS_EXCEEDED' },
      });
      throw error;
    }
  },
  {
    connection: queueConnection(config.REDIS_URL),
    concurrency: 4,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

const evaluationExecutor = new EvaluationExecutor(store, producer, {
  info: (data, message) => log('info', data, message),
  error: (data, message) => log('error', data, message),
});
const evaluationWorker = new Worker<EvaluationJobData>(
  EVALUATION_QUEUE_NAME,
  async (job) => {
    const evaluationRun = await store.getEvaluationRunById(job.data.evaluationRunId);
    if (!evaluationRun)
      throw new Error(`EvaluationRun ${job.data.evaluationRunId} does not exist.`);
    const cases = await store.listEvaluationCases(evaluationRun.projectId, evaluationRun.datasetId);
    const version = await store.getVersion(
      evaluationRun.projectId,
      evaluationRun.workflowId,
      evaluationRun.workflowVersionId,
    );
    if (!version) throw new Error('Evaluation WorkflowVersion is unavailable in its project.');
    await evaluationExecutor.execute(evaluationRun, cases, version);
  },
  {
    connection: queueConnection(config.REDIS_URL),
    concurrency: 2,
    lockDuration: 180_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);
evaluationWorker.on('error', (error) =>
  log('error', { error: error.message }, 'worker.evaluation_error'),
);
worker.on('error', (error) => log('error', { error: error.message }, 'worker.error'));
for (const run of await store.listRecoverableRuns()) {
  const jobId = await producer.enqueueRun(run.id, `recovery-${run.attemptCount}`);
  await store.updateRun(run.id, { status: 'QUEUED', queueJobId: jobId });
  await store.addTrace({
    runId: run.id,
    nodeRunId: null,
    eventType: 'RUN_QUEUED',
    metadata: { job_id: jobId, recovery: true },
  });
}
log('info', {}, 'worker.ready');

const shutdown = async () => {
  await Promise.all([worker.close(), evaluationWorker.close()]);
  await producer.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
