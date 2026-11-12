import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export const RUN_QUEUE_NAME = 'agentops-workflow-runs';
export const EVALUATION_QUEUE_NAME = 'agentops-evaluations';
export const KNOWLEDGE_INGESTION_QUEUE_NAME = 'agentops-knowledge-ingestion';
export interface RunJobData {
  runId: string;
}
export interface EvaluationJobData {
  evaluationRunId: string;
}
export interface KnowledgeIngestionJobData {
  documentId: string;
}
export interface DurableQueue {
  enqueueRun(runId: string, resumeKey?: string): Promise<string>;
  enqueueEvaluation(evaluationRunId: string): Promise<string>;
  enqueueKnowledgeIngestion(documentId: string): Promise<string>;
  removeRun(jobId: string): Promise<void>;
  close(): Promise<void>;
}

export const queueConnection = (redisUrl: string): IORedis =>
  new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });

export class BullDurableQueue implements DurableQueue {
  private readonly connection: IORedis;
  private readonly runs: Queue<RunJobData>;
  private readonly evaluations: Queue<EvaluationJobData>;
  private readonly ingestion: Queue<KnowledgeIngestionJobData>;
  private readonly options: JobsOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 500,
    removeOnFail: 1_000,
  };
  public constructor(redisUrl: string) {
    this.connection = queueConnection(redisUrl);
    this.runs = new Queue(RUN_QUEUE_NAME, { connection: this.connection });
    this.evaluations = new Queue(EVALUATION_QUEUE_NAME, { connection: this.connection });
    this.ingestion = new Queue(KNOWLEDGE_INGESTION_QUEUE_NAME, { connection: this.connection });
  }
  public async enqueueRun(runId: string, resumeKey = 'initial'): Promise<string> {
    const job = await this.runs.add(
      'execute-run',
      { runId },
      { ...this.options, jobId: `run-${runId}-${resumeKey}` },
    );
    return String(job.id);
  }
  public async enqueueEvaluation(evaluationRunId: string): Promise<string> {
    const job = await this.evaluations.add(
      'execute-evaluation',
      { evaluationRunId },
      { ...this.options, jobId: `evaluation-${evaluationRunId}` },
    );
    return String(job.id);
  }
  public async enqueueKnowledgeIngestion(documentId: string): Promise<string> {
    const job = await this.ingestion.add(
      'ingest-document',
      { documentId },
      { ...this.options, removeOnComplete: true, jobId: `knowledge-document-${documentId}` },
    );
    return String(job.id);
  }
  public async removeRun(jobId: string): Promise<void> {
    const job = await this.runs.getJob(jobId);
    if (job) await job.remove().catch(() => undefined);
  }
  public async close(): Promise<void> {
    await Promise.all([this.runs.close(), this.evaluations.close(), this.ingestion.close()]);
    await this.connection.quit();
  }
}
