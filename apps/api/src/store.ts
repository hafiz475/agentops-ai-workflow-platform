import type {
  EvaluationCaseStatus,
  EvaluationRunStatus,
  EvaluatorConfig,
  NodeRunStatus,
  RunStatus,
  ApprovalStatus,
  WorkflowGraph,
} from '@agentops/contracts';
import type { Pool } from 'pg';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  draftGraph: WorkflowGraph | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  versionNumber: number;
  graph: WorkflowGraph;
  createdAt: string;
}
export interface RunRecord {
  id: string;
  projectId: string;
  workflowId: string;
  workflowVersionId: string;
  status: RunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  queueJobId: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  cancellationRequestedAt: string | null;
  cancellationReason: string | null;
}
export interface NodeRunRecord {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  status: NodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface ApprovalRequestRecord {
  id: string;
  projectId: string;
  runId: string;
  nodeRunId: string;
  status: ApprovalStatus;
  title: string;
  instructions: string;
  requestedAt: string;
  decidedAt: string | null;
  decision: string | null;
  reviewerId: string | null;
  reviewerLabel: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TraceEventRecord {
  id: string;
  runId: string;
  nodeRunId: string | null;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type KnowledgeDocumentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
export interface KnowledgeSourceRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  sourceType: 'DOCUMENTS';
  embeddingProvider: 'development' | 'openai';
  embeddingModel: string;
  embeddingDimensions: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface KnowledgeDocumentRecord {
  id: string;
  knowledgeSourceId: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  sha256Hash: string;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  rawContent: Buffer;
  createdAt: string;
  updatedAt: string;
}
export interface KnowledgeChunkRecord {
  id: string;
  knowledgeSourceId: string;
  knowledgeDocumentId: string;
  projectId: string;
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface RetrievalResultRecord extends KnowledgeChunkRecord {
  filename: string;
  similarity: number;
}
export interface CitationValidationRecord {
  id: string;
  runId: string;
  nodeRunId: string;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
  sourceMetadata: Array<Record<string, unknown>>;
  createdAt: string;
}

export interface PromptRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PromptVersionRecord {
  id: string;
  promptId: string;
  versionNumber: number;
  template: string;
  variables: string[];
  changeNotes: string | null;
  createdAt: string;
}
export interface EvaluationDatasetRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationCaseRecord {
  id: string;
  datasetId: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  evaluatorConfig: EvaluatorConfig;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface EvaluationRunRecord {
  id: string;
  projectId: string;
  datasetId: string;
  workflowId: string;
  workflowVersionId: string;
  status: EvaluationRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageScore: number | null;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}
export interface EvaluationCaseResultRecord {
  id: string;
  evaluationRunId: string;
  evaluationCaseId: string;
  workflowRunId: string | null;
  status: EvaluationCaseStatus;
  actualOutput: Record<string, unknown> | null;
  score: number | null;
  passed: boolean | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Store {
  createProject(input: { name: string; description: string | null }): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  getProject(id: string): Promise<ProjectRecord | null>;
  createWorkflow(
    projectId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ): Promise<WorkflowRecord | null>;
  listWorkflows(projectId: string): Promise<WorkflowRecord[]>;
  getWorkflow(projectId: string, workflowId: string): Promise<WorkflowRecord | null>;
  updateWorkflow(
    projectId: string,
    workflowId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ): Promise<WorkflowRecord | null>;
  createVersion(
    projectId: string,
    workflowId: string,
    graph: WorkflowGraph,
  ): Promise<WorkflowVersionRecord | null>;
  listVersions(projectId: string, workflowId: string): Promise<WorkflowVersionRecord[]>;
  getVersion(
    projectId: string,
    workflowId: string,
    versionId: string,
  ): Promise<WorkflowVersionRecord | null>;
  getLatestVersion(projectId: string, workflowId: string): Promise<WorkflowVersionRecord | null>;
  createRun(input: {
    projectId: string;
    workflowId: string;
    workflowVersionId: string;
    runtimeInput: Record<string, unknown>;
  }): Promise<RunRecord>;
  listRuns(projectId: string, workflowId: string): Promise<RunRecord[]>;
  getRun(projectId: string, workflowId: string, runId: string): Promise<RunRecord | null>;
  getRunById(runId: string): Promise<RunRecord | null>;
  listRecoverableRuns(): Promise<RunRecord[]>;
  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        | 'status'
        | 'output'
        | 'errorCode'
        | 'errorMessage'
        | 'startedAt'
        | 'completedAt'
        | 'queueJobId'
        | 'attemptCount'
        | 'lastAttemptAt'
        | 'cancellationRequestedAt'
        | 'cancellationReason'
      >
    >,
  ): Promise<void>;
  createNodeRun(input: { runId: string; nodeId: string; nodeType: string }): Promise<NodeRunRecord>;
  getNodeRun(runId: string, nodeId: string): Promise<NodeRunRecord | null>;
  updateNodeRun(
    id: string,
    patch: Partial<
      Pick<
        NodeRunRecord,
        'status' | 'input' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<void>;
  listNodeRuns(runId: string): Promise<NodeRunRecord[]>;
  createApproval(input: {
    projectId: string;
    runId: string;
    nodeRunId: string;
    title: string;
    instructions: string;
  }): Promise<ApprovalRequestRecord>;
  listApprovals(projectId: string): Promise<ApprovalRequestRecord[]>;
  getApproval(projectId: string, approvalId: string): Promise<ApprovalRequestRecord | null>;
  getApprovalForNodeRun(nodeRunId: string): Promise<ApprovalRequestRecord | null>;
  decideApproval(
    projectId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    reason: string | null,
  ): Promise<ApprovalRequestRecord | null>;
  addTrace(input: {
    runId: string;
    nodeRunId: string | null;
    eventType: string;
    metadata: Record<string, unknown>;
  }): Promise<TraceEventRecord>;
  listTrace(
    projectId: string,
    workflowId: string,
    runId: string,
  ): Promise<TraceEventRecord[] | null>;
  createKnowledgeSource(
    projectId: string,
    input: {
      name: string;
      description: string | null;
      embeddingProvider: 'development' | 'openai';
      embeddingModel: string;
    },
  ): Promise<KnowledgeSourceRecord | null>;
  listKnowledgeSources(projectId: string): Promise<KnowledgeSourceRecord[]>;
  getKnowledgeSource(projectId: string, sourceId: string): Promise<KnowledgeSourceRecord | null>;
  createKnowledgeDocument(input: {
    projectId: string;
    knowledgeSourceId: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    sha256Hash: string;
    rawContent: Buffer;
  }): Promise<{ document: KnowledgeDocumentRecord; created: boolean } | null>;
  listKnowledgeDocuments(projectId: string, sourceId: string): Promise<KnowledgeDocumentRecord[]>;
  getKnowledgeDocument(
    projectId: string,
    sourceId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentRecord | null>;
  getKnowledgeDocumentById(documentId: string): Promise<KnowledgeDocumentRecord | null>;
  listRecoverableKnowledgeDocuments(): Promise<KnowledgeDocumentRecord[]>;
  updateKnowledgeDocument(
    documentId: string,
    patch: { status: KnowledgeDocumentStatus; errorMessage?: string | null },
  ): Promise<void>;
  replaceDocumentChunks(input: {
    document: KnowledgeDocumentRecord;
    provider: string;
    model: string;
    dimensions: number;
    chunks: Array<{
      chunkIndex: number;
      pageNumber: number | null;
      content: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>;
  }): Promise<void>;
  listKnowledgeChunks(
    projectId: string,
    sourceId: string,
    documentId?: string,
  ): Promise<KnowledgeChunkRecord[]>;
  searchKnowledgeChunks(input: {
    projectId: string;
    sourceId: string;
    provider: string;
    model: string;
    dimensions: number;
    queryEmbedding: number[];
    topK: number;
    documentId?: string;
  }): Promise<RetrievalResultRecord[]>;
  createCitationValidation(input: {
    runId: string;
    nodeRunId: string;
    retrievedChunkIds: string[];
    citedChunkIds: string[];
    sourceMetadata: Array<Record<string, unknown>>;
  }): Promise<CitationValidationRecord>;
  createPrompt(
    projectId: string,
    input: { name: string; description: string | null },
  ): Promise<PromptRecord | null>;
  listPrompts(projectId: string): Promise<PromptRecord[]>;
  getPrompt(projectId: string, promptId: string): Promise<PromptRecord | null>;
  createPromptVersion(
    projectId: string,
    promptId: string,
    input: { template: string; variables: string[]; changeNotes: string | null },
  ): Promise<PromptVersionRecord | null>;
  listPromptVersions(projectId: string, promptId: string): Promise<PromptVersionRecord[]>;
  getPromptVersion(
    projectId: string,
    promptId: string,
    versionId: string,
  ): Promise<PromptVersionRecord | null>;
  getPromptVersionById(projectId: string, versionId: string): Promise<PromptVersionRecord | null>;
  createEvaluationDataset(
    projectId: string,
    input: { name: string; description: string | null },
  ): Promise<EvaluationDatasetRecord | null>;
  listEvaluationDatasets(projectId: string): Promise<EvaluationDatasetRecord[]>;
  getEvaluationDataset(
    projectId: string,
    datasetId: string,
  ): Promise<EvaluationDatasetRecord | null>;
  createEvaluationCase(
    projectId: string,
    datasetId: string,
    input: {
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
      evaluatorConfig: EvaluatorConfig;
      metadata: Record<string, unknown>;
    },
  ): Promise<EvaluationCaseRecord | null>;
  listEvaluationCases(projectId: string, datasetId: string): Promise<EvaluationCaseRecord[]>;
  createEvaluationRun(input: {
    projectId: string;
    datasetId: string;
    workflowId: string;
    workflowVersionId: string;
    totalCases: number;
  }): Promise<EvaluationRunRecord>;
  listEvaluationRuns(projectId: string): Promise<EvaluationRunRecord[]>;
  getEvaluationRun(projectId: string, runId: string): Promise<EvaluationRunRecord | null>;
  getEvaluationRunById(runId: string): Promise<EvaluationRunRecord | null>;
  updateEvaluationRun(
    runId: string,
    patch: Partial<
      Omit<
        EvaluationRunRecord,
        'id' | 'projectId' | 'datasetId' | 'workflowId' | 'workflowVersionId' | 'createdAt'
      >
    >,
  ): Promise<void>;
  createEvaluationCaseResult(input: {
    evaluationRunId: string;
    evaluationCaseId: string;
  }): Promise<EvaluationCaseResultRecord>;
  updateEvaluationCaseResult(
    id: string,
    patch: Partial<
      Omit<EvaluationCaseResultRecord, 'id' | 'evaluationRunId' | 'evaluationCaseId' | 'createdAt'>
    >,
  ): Promise<void>;
  listEvaluationCaseResults(
    projectId: string,
    evaluationRunId: string,
  ): Promise<EvaluationCaseResultRecord[] | null>;
}

const projectFromRow = (row: Record<string, unknown>): ProjectRecord => ({
  id: String(row.id),
  name: String(row.name),
  description: row.description === null ? null : String(row.description),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const workflowFromRow = (row: Record<string, unknown>): WorkflowRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  name: String(row.name),
  description: row.description === null ? null : String(row.description),
  draftGraph: (row.draft_graph_json as WorkflowGraph | null) ?? null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const versionFromRow = (row: Record<string, unknown>): WorkflowVersionRecord => ({
  id: String(row.id),
  workflowId: String(row.workflow_id),
  versionNumber: Number(row.version_number),
  graph: row.graph_json as WorkflowGraph,
  createdAt: String(row.created_at),
});
const runFromRow = (row: Record<string, unknown>): RunRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  workflowId: String(row.workflow_id),
  workflowVersionId: String(row.workflow_version_id),
  status: row.status as RunStatus,
  input: row.input_json as Record<string, unknown>,
  output: (row.output_json as Record<string, unknown> | null) ?? null,
  errorCode: row.error_code === null ? null : String(row.error_code),
  errorMessage: row.error_message === null ? null : String(row.error_message),
  startedAt: row.started_at === null ? null : String(row.started_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
  createdAt: String(row.created_at),
  queueJobId: row.queue_job_id == null ? null : String(row.queue_job_id),
  attemptCount: Number(row.attempt_count ?? 0),
  maxAttempts: Number(row.max_attempts ?? 3),
  lastAttemptAt: row.last_attempt_at == null ? null : String(row.last_attempt_at),
  cancellationRequestedAt:
    row.cancellation_requested_at == null ? null : String(row.cancellation_requested_at),
  cancellationReason: row.cancellation_reason == null ? null : String(row.cancellation_reason),
});
const nodeRunFromRow = (row: Record<string, unknown>): NodeRunRecord => ({
  id: String(row.id),
  runId: String(row.run_id),
  nodeId: String(row.node_id),
  nodeType: String(row.node_type),
  status: row.status as NodeRunStatus,
  input: (row.input_json as Record<string, unknown> | null) ?? null,
  output: (row.output_json as Record<string, unknown> | null) ?? null,
  errorCode: row.error_code === null ? null : String(row.error_code),
  errorMessage: row.error_message === null ? null : String(row.error_message),
  startedAt: row.started_at === null ? null : String(row.started_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
  createdAt: String(row.created_at),
});
const approvalFromRow = (row: Record<string, unknown>): ApprovalRequestRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  runId: String(row.run_id),
  nodeRunId: String(row.node_run_id),
  status: row.status as ApprovalStatus,
  title: String(row.title),
  instructions: String(row.instructions),
  requestedAt: String(row.requested_at),
  decidedAt: row.decided_at == null ? null : String(row.decided_at),
  decision: row.decision == null ? null : String(row.decision),
  reviewerId: row.reviewer_id == null ? null : String(row.reviewer_id),
  reviewerLabel: row.reviewer_label == null ? null : String(row.reviewer_label),
  reason: row.reason == null ? null : String(row.reason),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const traceFromRow = (row: Record<string, unknown>): TraceEventRecord => ({
  id: String(row.id),
  runId: String(row.run_id),
  nodeRunId: row.node_run_id === null ? null : String(row.node_run_id),
  eventType: String(row.event_type),
  metadata: row.metadata as Record<string, unknown>,
  createdAt: String(row.created_at),
});
const knowledgeSourceFromRow = (row: Record<string, unknown>): KnowledgeSourceRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  name: String(row.name),
  description: row.description == null ? null : String(row.description),
  sourceType: 'DOCUMENTS',
  embeddingProvider: row.embedding_provider as 'development' | 'openai',
  embeddingModel: String(row.embedding_model),
  embeddingDimensions: row.embedding_dimensions == null ? null : Number(row.embedding_dimensions),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const knowledgeDocumentFromRow = (row: Record<string, unknown>): KnowledgeDocumentRecord => ({
  id: String(row.id),
  knowledgeSourceId: String(row.knowledge_source_id),
  projectId: String(row.project_id),
  originalFilename: String(row.original_filename),
  mimeType: String(row.mime_type),
  fileSize: Number(row.file_size),
  sha256Hash: String(row.sha256_hash),
  status: row.status as KnowledgeDocumentStatus,
  errorMessage: row.error_message == null ? null : String(row.error_message),
  rawContent: Buffer.isBuffer(row.raw_content)
    ? row.raw_content
    : Buffer.from(row.raw_content as Uint8Array),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const knowledgeChunkFromRow = (row: Record<string, unknown>): KnowledgeChunkRecord => ({
  id: String(row.id),
  knowledgeSourceId: String(row.knowledge_source_id),
  knowledgeDocumentId: String(row.knowledge_document_id),
  projectId: String(row.project_id),
  chunkIndex: Number(row.chunk_index),
  pageNumber: row.page_number == null ? null : Number(row.page_number),
  content: String(row.content),
  metadata: (row.metadata_json as Record<string, unknown>) ?? {},
  createdAt: String(row.created_at),
});
const retrievalResultFromRow = (row: Record<string, unknown>): RetrievalResultRecord => ({
  ...knowledgeChunkFromRow(row),
  filename: String(row.original_filename),
  similarity: Number(row.similarity),
});
const citationValidationFromRow = (row: Record<string, unknown>): CitationValidationRecord => ({
  id: String(row.id),
  runId: String(row.run_id),
  nodeRunId: String(row.node_run_id),
  retrievedChunkIds: (row.retrieved_chunk_ids as string[]) ?? [],
  citedChunkIds: (row.cited_chunk_ids as string[]) ?? [],
  sourceMetadata: (row.source_metadata as Array<Record<string, unknown>>) ?? [],
  createdAt: String(row.created_at),
});

const promptFromRow = (row: Record<string, unknown>): PromptRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  name: String(row.name),
  description: row.description === null ? null : String(row.description),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const promptVersionFromRow = (row: Record<string, unknown>): PromptVersionRecord => ({
  id: String(row.id),
  promptId: String(row.prompt_id),
  versionNumber: Number(row.version_number),
  template: String(row.template),
  variables: row.variables as string[],
  changeNotes: row.change_notes === null ? null : String(row.change_notes),
  createdAt: String(row.created_at),
});
const evaluationDatasetFromRow = (row: Record<string, unknown>): EvaluationDatasetRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  name: String(row.name),
  description: row.description === null ? null : String(row.description),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});
const evaluationCaseFromRow = (row: Record<string, unknown>): EvaluationCaseRecord => ({
  id: String(row.id),
  datasetId: String(row.dataset_id),
  input: row.input_json as Record<string, unknown>,
  expectedOutput: row.expected_output_json as Record<string, unknown>,
  evaluatorConfig: row.evaluator_config as EvaluatorConfig,
  metadata: row.metadata_json as Record<string, unknown>,
  createdAt: String(row.created_at),
});
const evaluationRunFromRow = (row: Record<string, unknown>): EvaluationRunRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  datasetId: String(row.dataset_id),
  workflowId: String(row.workflow_id),
  workflowVersionId: String(row.workflow_version_id),
  status: row.status as EvaluationRunStatus,
  startedAt: row.started_at === null ? null : String(row.started_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
  totalCases: Number(row.total_cases),
  passedCases: Number(row.passed_cases),
  failedCases: Number(row.failed_cases),
  averageScore: row.average_score === null ? null : Number(row.average_score),
  averageLatencyMs: row.average_latency_ms === null ? null : Number(row.average_latency_ms),
  p50LatencyMs: row.p50_latency_ms === null ? null : Number(row.p50_latency_ms),
  p95LatencyMs: row.p95_latency_ms === null ? null : Number(row.p95_latency_ms),
  inputTokens: Number(row.input_tokens),
  outputTokens: Number(row.output_tokens),
  totalTokens: Number(row.total_tokens),
  errorCode: row.error_code === null ? null : String(row.error_code),
  errorMessage: row.error_message === null ? null : String(row.error_message),
  createdAt: String(row.created_at),
});
const evaluationCaseResultFromRow = (row: Record<string, unknown>): EvaluationCaseResultRecord => ({
  id: String(row.id),
  evaluationRunId: String(row.evaluation_run_id),
  evaluationCaseId: String(row.evaluation_case_id),
  workflowRunId: row.workflow_run_id === null ? null : String(row.workflow_run_id),
  status: row.status as EvaluationCaseStatus,
  actualOutput: (row.actual_output_json as Record<string, unknown> | null) ?? null,
  score: row.score === null ? null : Number(row.score),
  passed: row.passed === null ? null : Boolean(row.passed),
  latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
  inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
  outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
  errorCode: row.error_code === null ? null : String(row.error_code),
  errorMessage: row.error_message === null ? null : String(row.error_message),
  createdAt: String(row.created_at),
});

export class PostgresStore implements Store {
  public constructor(private readonly pool: Pool) {}
  public async createProject(input: {
    name: string;
    description: string | null;
  }): Promise<ProjectRecord> {
    const { rows } = await this.pool.query(
      'INSERT INTO projects(name, description) VALUES($1,$2) RETURNING *',
      [input.name, input.description],
    );
    return projectFromRow(rows[0] as Record<string, unknown>);
  }
  public async listProjects(): Promise<ProjectRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM projects ORDER BY created_at');
    return rows.map((row) => projectFromRow(row as Record<string, unknown>));
  }
  public async getProject(id: string): Promise<ProjectRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM projects WHERE id=$1', [id]);
    return rows[0] ? projectFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createWorkflow(
    projectId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ): Promise<WorkflowRecord | null> {
    const { rows } = await this.pool.query(
      'INSERT INTO workflows(project_id,name,description,draft_graph_json) SELECT id,$2,$3,$4 FROM projects WHERE id=$1 RETURNING *',
      [projectId, input.name, input.description, input.draftGraph],
    );
    return rows[0] ? workflowFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listWorkflows(projectId: string): Promise<WorkflowRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM workflows WHERE project_id=$1 ORDER BY created_at',
      [projectId],
    );
    return rows.map((row) => workflowFromRow(row as Record<string, unknown>));
  }
  public async getWorkflow(projectId: string, workflowId: string): Promise<WorkflowRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM workflows WHERE id=$2 AND project_id=$1',
      [projectId, workflowId],
    );
    return rows[0] ? workflowFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async updateWorkflow(
    projectId: string,
    workflowId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ): Promise<WorkflowRecord | null> {
    const { rows } = await this.pool.query(
      'UPDATE workflows SET name=$3,description=$4,draft_graph_json=$5,updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *',
      [projectId, workflowId, input.name, input.description, input.draftGraph],
    );
    return rows[0] ? workflowFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createVersion(
    projectId: string,
    workflowId: string,
    graph: WorkflowGraph,
  ): Promise<WorkflowVersionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scoped = await client.query(
        'SELECT id FROM workflows WHERE id=$2 AND project_id=$1 FOR UPDATE',
        [projectId, workflowId],
      );
      if (!scoped.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        'INSERT INTO workflow_versions(workflow_id,version_number,graph_json) SELECT $1,COALESCE(MAX(version_number),0)+1,$2 FROM workflow_versions WHERE workflow_id=$1 RETURNING *',
        [workflowId, graph],
      );
      await client.query('COMMIT');
      return versionFromRow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  public async listVersions(
    projectId: string,
    workflowId: string,
  ): Promise<WorkflowVersionRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.project_id=$1 AND w.id=$2 ORDER BY v.version_number DESC',
      [projectId, workflowId],
    );
    return rows.map((row) => versionFromRow(row as Record<string, unknown>));
  }
  public async getVersion(
    projectId: string,
    workflowId: string,
    versionId: string,
  ): Promise<WorkflowVersionRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.project_id=$1 AND w.id=$2 AND v.id=$3',
      [projectId, workflowId, versionId],
    );
    return rows[0] ? versionFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getLatestVersion(
    projectId: string,
    workflowId: string,
  ): Promise<WorkflowVersionRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.project_id=$1 AND w.id=$2 ORDER BY v.version_number DESC LIMIT 1',
      [projectId, workflowId],
    );
    return rows[0] ? versionFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createRun(input: {
    projectId: string;
    workflowId: string;
    workflowVersionId: string;
    runtimeInput: Record<string, unknown>;
  }): Promise<RunRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO runs(project_id,workflow_id,workflow_version_id,status,input_json) VALUES($1,$2,$3,'QUEUED',$4) RETURNING *",
      [input.projectId, input.workflowId, input.workflowVersionId, input.runtimeInput],
    );
    return runFromRow(rows[0] as Record<string, unknown>);
  }
  public async listRuns(projectId: string, workflowId: string): Promise<RunRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM runs WHERE project_id=$1 AND workflow_id=$2 ORDER BY created_at DESC',
      [projectId, workflowId],
    );
    return rows.map((row) => runFromRow(row as Record<string, unknown>));
  }
  public async getRun(
    projectId: string,
    workflowId: string,
    runId: string,
  ): Promise<RunRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM runs WHERE project_id=$1 AND workflow_id=$2 AND id=$3',
      [projectId, workflowId, runId],
    );
    return rows[0] ? runFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getRunById(runId: string): Promise<RunRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM runs WHERE id=$1', [runId]);
    return rows[0] ? runFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listRecoverableRuns(): Promise<RunRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM runs WHERE status IN ('QUEUED','RUNNING') ORDER BY created_at",
    );
    return rows.map((row) => runFromRow(row as Record<string, unknown>));
  }
  public async updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        | 'status'
        | 'output'
        | 'errorCode'
        | 'errorMessage'
        | 'startedAt'
        | 'completedAt'
        | 'queueJobId'
        | 'attemptCount'
        | 'lastAttemptAt'
        | 'cancellationRequestedAt'
        | 'cancellationReason'
      >
    >,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE runs SET status=COALESCE($2,status),output_json=COALESCE($3,output_json),error_code=$4,error_message=$5,started_at=COALESCE($6,started_at),completed_at=COALESCE($7,completed_at),queue_job_id=COALESCE($8,queue_job_id),attempt_count=COALESCE($9,attempt_count),last_attempt_at=COALESCE($10,last_attempt_at),cancellation_requested_at=COALESCE($11,cancellation_requested_at),cancellation_reason=COALESCE($12,cancellation_reason) WHERE id=$1',
      [
        runId,
        patch.status ?? null,
        patch.output ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        patch.startedAt ?? null,
        patch.completedAt ?? null,
        patch.queueJobId ?? null,
        patch.attemptCount ?? null,
        patch.lastAttemptAt ?? null,
        patch.cancellationRequestedAt ?? null,
        patch.cancellationReason ?? null,
      ],
    );
  }
  public async createNodeRun(input: {
    runId: string;
    nodeId: string;
    nodeType: string;
  }): Promise<NodeRunRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO node_runs(run_id,node_id,node_type,status) VALUES($1,$2,$3,'PENDING') ON CONFLICT (run_id,node_id) DO UPDATE SET node_type=EXCLUDED.node_type RETURNING *",
      [input.runId, input.nodeId, input.nodeType],
    );
    return nodeRunFromRow(rows[0] as Record<string, unknown>);
  }
  public async getNodeRun(runId: string, nodeId: string): Promise<NodeRunRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM node_runs WHERE run_id=$1 AND node_id=$2',
      [runId, nodeId],
    );
    return rows[0] ? nodeRunFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async updateNodeRun(
    id: string,
    patch: Partial<
      Pick<
        NodeRunRecord,
        'status' | 'input' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE node_runs SET status=COALESCE($2,status),input_json=COALESCE($3,input_json),output_json=COALESCE($4,output_json),error_code=$5,error_message=$6,started_at=COALESCE($7,started_at),completed_at=COALESCE($8,completed_at) WHERE id=$1',
      [
        id,
        patch.status ?? null,
        patch.input ?? null,
        patch.output ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        patch.startedAt ?? null,
        patch.completedAt ?? null,
      ],
    );
  }
  public async listNodeRuns(runId: string): Promise<NodeRunRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM node_runs WHERE run_id=$1 ORDER BY created_at',
      [runId],
    );
    return rows.map((row) => nodeRunFromRow(row as Record<string, unknown>));
  }
  public async createApproval(input: {
    projectId: string;
    runId: string;
    nodeRunId: string;
    title: string;
    instructions: string;
  }): Promise<ApprovalRequestRecord> {
    const { rows } = await this.pool.query(
      'INSERT INTO approval_requests(project_id,run_id,node_run_id,title,instructions) VALUES($1,$2,$3,$4,$5) ON CONFLICT (node_run_id) DO UPDATE SET updated_at=NOW() RETURNING *',
      [input.projectId, input.runId, input.nodeRunId, input.title, input.instructions],
    );
    return approvalFromRow(rows[0] as Record<string, unknown>);
  }
  public async listApprovals(projectId: string): Promise<ApprovalRequestRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM approval_requests WHERE project_id=$1 ORDER BY requested_at DESC',
      [projectId],
    );
    return rows.map((row) => approvalFromRow(row as Record<string, unknown>));
  }
  public async getApproval(
    projectId: string,
    approvalId: string,
  ): Promise<ApprovalRequestRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM approval_requests WHERE project_id=$1 AND id=$2',
      [projectId, approvalId],
    );
    return rows[0] ? approvalFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getApprovalForNodeRun(nodeRunId: string): Promise<ApprovalRequestRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM approval_requests WHERE node_run_id=$1', [
      nodeRunId,
    ]);
    return rows[0] ? approvalFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async decideApproval(
    projectId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    reason: string | null,
  ): Promise<ApprovalRequestRecord | null> {
    const { rows } = await this.pool.query(
      "UPDATE approval_requests SET status=$3,decision=$3,reason=$4,reviewer_label='demo-reviewer',decided_at=NOW(),updated_at=NOW() WHERE project_id=$1 AND id=$2 AND status='PENDING' RETURNING *",
      [projectId, approvalId, decision, reason],
    );
    return rows[0] ? approvalFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async addTrace(input: {
    runId: string;
    nodeRunId: string | null;
    eventType: string;
    metadata: Record<string, unknown>;
  }): Promise<TraceEventRecord> {
    const { rows } = await this.pool.query(
      'INSERT INTO trace_events(run_id,node_run_id,event_type,metadata) VALUES($1,$2,$3,$4) RETURNING *',
      [input.runId, input.nodeRunId, input.eventType, input.metadata],
    );
    return traceFromRow(rows[0] as Record<string, unknown>);
  }
  public async listTrace(
    projectId: string,
    workflowId: string,
    runId: string,
  ): Promise<TraceEventRecord[] | null> {
    const scoped = await this.getRun(projectId, workflowId, runId);
    if (!scoped) return null;
    const { rows } = await this.pool.query(
      'SELECT * FROM trace_events WHERE run_id=$1 ORDER BY created_at,id',
      [runId],
    );
    return rows.map((row) => traceFromRow(row as Record<string, unknown>));
  }
  public async createKnowledgeSource(
    projectId: string,
    input: {
      name: string;
      description: string | null;
      embeddingProvider: 'development' | 'openai';
      embeddingModel: string;
    },
  ): Promise<KnowledgeSourceRecord | null> {
    const { rows } = await this.pool.query(
      "INSERT INTO knowledge_sources(project_id,name,description,source_type,embedding_provider,embedding_model) SELECT id,$2,$3,'DOCUMENTS',$4,$5 FROM projects WHERE id=$1 RETURNING *",
      [projectId, input.name, input.description, input.embeddingProvider, input.embeddingModel],
    );
    return rows[0] ? knowledgeSourceFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listKnowledgeSources(projectId: string): Promise<KnowledgeSourceRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_sources WHERE project_id=$1 ORDER BY updated_at DESC',
      [projectId],
    );
    return rows.map((row) => knowledgeSourceFromRow(row as Record<string, unknown>));
  }
  public async getKnowledgeSource(
    projectId: string,
    sourceId: string,
  ): Promise<KnowledgeSourceRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_sources WHERE project_id=$1 AND id=$2',
      [projectId, sourceId],
    );
    return rows[0] ? knowledgeSourceFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createKnowledgeDocument(input: {
    projectId: string;
    knowledgeSourceId: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    sha256Hash: string;
    rawContent: Buffer;
  }): Promise<{ document: KnowledgeDocumentRecord; created: boolean } | null> {
    const { rows } = await this.pool.query(
      "INSERT INTO knowledge_documents(knowledge_source_id,project_id,original_filename,mime_type,file_size,sha256_hash,status,raw_content) SELECT s.id,s.project_id,$3,$4,$5,$6,'UPLOADED',$7 FROM knowledge_sources s WHERE s.project_id=$1 AND s.id=$2 ON CONFLICT (knowledge_source_id,sha256_hash) DO NOTHING RETURNING *",
      [
        input.projectId,
        input.knowledgeSourceId,
        input.originalFilename,
        input.mimeType,
        input.fileSize,
        input.sha256Hash,
        input.rawContent,
      ],
    );
    if (rows[0])
      return {
        document: knowledgeDocumentFromRow(rows[0] as Record<string, unknown>),
        created: true,
      };
    const existing = await this.pool.query(
      'SELECT * FROM knowledge_documents WHERE project_id=$1 AND knowledge_source_id=$2 AND sha256_hash=$3',
      [input.projectId, input.knowledgeSourceId, input.sha256Hash],
    );
    return existing.rows[0]
      ? {
          document: knowledgeDocumentFromRow(existing.rows[0] as Record<string, unknown>),
          created: false,
        }
      : null;
  }
  public async listKnowledgeDocuments(
    projectId: string,
    sourceId: string,
  ): Promise<KnowledgeDocumentRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_documents WHERE project_id=$1 AND knowledge_source_id=$2 ORDER BY created_at DESC',
      [projectId, sourceId],
    );
    return rows.map((row) => knowledgeDocumentFromRow(row as Record<string, unknown>));
  }
  public async getKnowledgeDocument(
    projectId: string,
    sourceId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_documents WHERE project_id=$1 AND knowledge_source_id=$2 AND id=$3',
      [projectId, sourceId, documentId],
    );
    return rows[0] ? knowledgeDocumentFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getKnowledgeDocumentById(
    documentId: string,
  ): Promise<KnowledgeDocumentRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_documents WHERE id=$1', [
      documentId,
    ]);
    return rows[0] ? knowledgeDocumentFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listRecoverableKnowledgeDocuments(): Promise<KnowledgeDocumentRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM knowledge_documents WHERE status IN ('UPLOADED','PROCESSING') ORDER BY created_at",
    );
    return rows.map((row) => knowledgeDocumentFromRow(row as Record<string, unknown>));
  }
  public async updateKnowledgeDocument(
    documentId: string,
    patch: { status: KnowledgeDocumentStatus; errorMessage?: string | null },
  ): Promise<void> {
    await this.pool.query(
      'UPDATE knowledge_documents SET status=$2,error_message=$3,updated_at=NOW() WHERE id=$1',
      [documentId, patch.status, patch.errorMessage ?? null],
    );
  }
  public async replaceDocumentChunks(input: {
    document: KnowledgeDocumentRecord;
    provider: string;
    model: string;
    dimensions: number;
    chunks: Array<{
      chunkIndex: number;
      pageNumber: number | null;
      content: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        'SELECT * FROM knowledge_sources WHERE project_id=$1 AND id=$2 FOR UPDATE',
        [input.document.projectId, input.document.knowledgeSourceId],
      );
      const row = source.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error('KnowledgeSource is unavailable in the document project.');
      if (row.embedding_provider !== input.provider || row.embedding_model !== input.model)
        throw new Error('Embedding provider or model does not match the KnowledgeSource.');
      if (row.embedding_dimensions != null && Number(row.embedding_dimensions) !== input.dimensions)
        throw new Error('Embedding dimensions do not match existing source embeddings.');
      if (input.chunks.some((chunk) => chunk.embedding.length !== input.dimensions))
        throw new Error('Embedding dimensions are inconsistent.');
      await client.query(
        'UPDATE knowledge_sources SET embedding_dimensions=$2,updated_at=NOW() WHERE id=$1',
        [input.document.knowledgeSourceId, input.dimensions],
      );
      await client.query('DELETE FROM knowledge_chunks WHERE knowledge_document_id=$1', [
        input.document.id,
      ]);
      for (const chunk of input.chunks) {
        const inserted = await client.query(
          'INSERT INTO knowledge_chunks(knowledge_source_id,knowledge_document_id,project_id,chunk_index,page_number,content,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            input.document.knowledgeSourceId,
            input.document.id,
            input.document.projectId,
            chunk.chunkIndex,
            chunk.pageNumber,
            chunk.content,
            chunk.metadata,
          ],
        );
        const chunkId = String(inserted.rows[0]?.id);
        await client.query(
          'INSERT INTO knowledge_chunk_embeddings(knowledge_chunk_id,project_id,embedding,provider,model,dimensions,version) VALUES($1,$2,$3::vector,$4,$5,$6,1)',
          [
            chunkId,
            input.document.projectId,
            `[${chunk.embedding.join(',')}]`,
            input.provider,
            input.model,
            input.dimensions,
          ],
        );
      }
      await client.query(
        "UPDATE knowledge_documents SET status='READY',error_message=NULL,updated_at=NOW() WHERE id=$1",
        [input.document.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  public async listKnowledgeChunks(
    projectId: string,
    sourceId: string,
    documentId?: string,
  ): Promise<KnowledgeChunkRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_chunks WHERE project_id=$1 AND knowledge_source_id=$2 AND ($3::uuid IS NULL OR knowledge_document_id=$3) ORDER BY knowledge_document_id,chunk_index',
      [projectId, sourceId, documentId ?? null],
    );
    return rows.map((row) => knowledgeChunkFromRow(row as Record<string, unknown>));
  }
  public async searchKnowledgeChunks(input: {
    projectId: string;
    sourceId: string;
    provider: string;
    model: string;
    dimensions: number;
    queryEmbedding: number[];
    topK: number;
    documentId?: string;
  }): Promise<RetrievalResultRecord[]> {
    if (input.queryEmbedding.length !== input.dimensions)
      throw new Error('Query embedding dimensions are inconsistent.');
    const vector = `[${input.queryEmbedding.join(',')}]`;
    const { rows } = await this.pool.query(
      'SELECT c.*,d.original_filename,1-(e.embedding <=> $7::vector) AS similarity FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.knowledge_document_id JOIN knowledge_chunk_embeddings e ON e.knowledge_chunk_id=c.id WHERE c.project_id=$1 AND c.knowledge_source_id=$2 AND e.provider=$3 AND e.model=$4 AND e.dimensions=$5 AND ($6::uuid IS NULL OR c.knowledge_document_id=$6) ORDER BY e.embedding <=> $7::vector,c.chunk_index LIMIT $8',
      [
        input.projectId,
        input.sourceId,
        input.provider,
        input.model,
        input.dimensions,
        input.documentId ?? null,
        vector,
        input.topK,
      ],
    );
    return rows.map((row) => retrievalResultFromRow(row as Record<string, unknown>));
  }
  public async createCitationValidation(input: {
    runId: string;
    nodeRunId: string;
    retrievedChunkIds: string[];
    citedChunkIds: string[];
    sourceMetadata: Array<Record<string, unknown>>;
  }): Promise<CitationValidationRecord> {
    const { rows } = await this.pool.query(
      'INSERT INTO citation_validations(run_id,node_run_id,retrieved_chunk_ids,cited_chunk_ids,source_metadata) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [
        input.runId,
        input.nodeRunId,
        input.retrievedChunkIds,
        input.citedChunkIds,
        JSON.stringify(input.sourceMetadata),
      ],
    );
    return citationValidationFromRow(rows[0] as Record<string, unknown>);
  }
  public async createPrompt(
    projectId: string,
    input: { name: string; description: string | null },
  ): Promise<PromptRecord | null> {
    const { rows } = await this.pool.query(
      'INSERT INTO prompts(project_id,name,description) SELECT id,$2,$3 FROM projects WHERE id=$1 RETURNING *',
      [projectId, input.name, input.description],
    );
    return rows[0] ? promptFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listPrompts(projectId: string): Promise<PromptRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM prompts WHERE project_id=$1 ORDER BY updated_at DESC',
      [projectId],
    );
    return rows.map((row) => promptFromRow(row as Record<string, unknown>));
  }
  public async getPrompt(projectId: string, promptId: string): Promise<PromptRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM prompts WHERE project_id=$1 AND id=$2', [
      projectId,
      promptId,
    ]);
    return rows[0] ? promptFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createPromptVersion(
    projectId: string,
    promptId: string,
    input: { template: string; variables: string[]; changeNotes: string | null },
  ): Promise<PromptVersionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scoped = await client.query(
        'SELECT id FROM prompts WHERE project_id=$1 AND id=$2 FOR UPDATE',
        [projectId, promptId],
      );
      if (!scoped.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        'INSERT INTO prompt_versions(prompt_id,version_number,template,variables,change_notes) SELECT $1,COALESCE(MAX(version_number),0)+1,$2,$3,$4 FROM prompt_versions WHERE prompt_id=$1 RETURNING *',
        [promptId, input.template, JSON.stringify(input.variables), input.changeNotes],
      );
      await client.query('UPDATE prompts SET updated_at=now() WHERE id=$1', [promptId]);
      await client.query('COMMIT');
      return promptVersionFromRow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  public async listPromptVersions(
    projectId: string,
    promptId: string,
  ): Promise<PromptVersionRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM prompt_versions v JOIN prompts p ON p.id=v.prompt_id WHERE p.project_id=$1 AND p.id=$2 ORDER BY v.version_number DESC',
      [projectId, promptId],
    );
    return rows.map((row) => promptVersionFromRow(row as Record<string, unknown>));
  }
  public async getPromptVersion(
    projectId: string,
    promptId: string,
    versionId: string,
  ): Promise<PromptVersionRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM prompt_versions v JOIN prompts p ON p.id=v.prompt_id WHERE p.project_id=$1 AND p.id=$2 AND v.id=$3',
      [projectId, promptId, versionId],
    );
    return rows[0] ? promptVersionFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getPromptVersionById(
    projectId: string,
    versionId: string,
  ): Promise<PromptVersionRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT v.* FROM prompt_versions v JOIN prompts p ON p.id=v.prompt_id WHERE p.project_id=$1 AND v.id=$2',
      [projectId, versionId],
    );
    return rows[0] ? promptVersionFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createEvaluationDataset(
    projectId: string,
    input: { name: string; description: string | null },
  ): Promise<EvaluationDatasetRecord | null> {
    const { rows } = await this.pool.query(
      'INSERT INTO evaluation_datasets(project_id,name,description) SELECT id,$2,$3 FROM projects WHERE id=$1 RETURNING *',
      [projectId, input.name, input.description],
    );
    return rows[0] ? evaluationDatasetFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listEvaluationDatasets(projectId: string): Promise<EvaluationDatasetRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM evaluation_datasets WHERE project_id=$1 ORDER BY updated_at DESC',
      [projectId],
    );
    return rows.map((row) => evaluationDatasetFromRow(row as Record<string, unknown>));
  }
  public async getEvaluationDataset(
    projectId: string,
    datasetId: string,
  ): Promise<EvaluationDatasetRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM evaluation_datasets WHERE project_id=$1 AND id=$2',
      [projectId, datasetId],
    );
    return rows[0] ? evaluationDatasetFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async createEvaluationCase(
    projectId: string,
    datasetId: string,
    input: {
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
      evaluatorConfig: EvaluatorConfig;
      metadata: Record<string, unknown>;
    },
  ): Promise<EvaluationCaseRecord | null> {
    const { rows } = await this.pool.query(
      'INSERT INTO evaluation_cases(dataset_id,input_json,expected_output_json,evaluator_config,metadata_json) SELECT d.id,$3,$4,$5,$6 FROM evaluation_datasets d WHERE d.project_id=$1 AND d.id=$2 RETURNING *',
      [
        projectId,
        datasetId,
        input.input,
        input.expectedOutput,
        input.evaluatorConfig,
        input.metadata,
      ],
    );
    if (rows[0])
      await this.pool.query('UPDATE evaluation_datasets SET updated_at=now() WHERE id=$1', [
        datasetId,
      ]);
    return rows[0] ? evaluationCaseFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async listEvaluationCases(
    projectId: string,
    datasetId: string,
  ): Promise<EvaluationCaseRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT c.* FROM evaluation_cases c JOIN evaluation_datasets d ON d.id=c.dataset_id WHERE d.project_id=$1 AND d.id=$2 ORDER BY c.created_at',
      [projectId, datasetId],
    );
    return rows.map((row) => evaluationCaseFromRow(row as Record<string, unknown>));
  }
  public async createEvaluationRun(input: {
    projectId: string;
    datasetId: string;
    workflowId: string;
    workflowVersionId: string;
    totalCases: number;
  }): Promise<EvaluationRunRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO evaluation_runs(project_id,dataset_id,workflow_id,workflow_version_id,status,total_cases) VALUES($1,$2,$3,$4,'QUEUED',$5) RETURNING *",
      [
        input.projectId,
        input.datasetId,
        input.workflowId,
        input.workflowVersionId,
        input.totalCases,
      ],
    );
    return evaluationRunFromRow(rows[0] as Record<string, unknown>);
  }
  public async listEvaluationRuns(projectId: string): Promise<EvaluationRunRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM evaluation_runs WHERE project_id=$1 ORDER BY created_at DESC',
      [projectId],
    );
    return rows.map((row) => evaluationRunFromRow(row as Record<string, unknown>));
  }
  public async getEvaluationRun(
    projectId: string,
    runId: string,
  ): Promise<EvaluationRunRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM evaluation_runs WHERE project_id=$1 AND id=$2',
      [projectId, runId],
    );
    return rows[0] ? evaluationRunFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async getEvaluationRunById(runId: string): Promise<EvaluationRunRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM evaluation_runs WHERE id=$1', [runId]);
    return rows[0] ? evaluationRunFromRow(rows[0] as Record<string, unknown>) : null;
  }
  public async updateEvaluationRun(
    runId: string,
    patch: Partial<
      Omit<
        EvaluationRunRecord,
        'id' | 'projectId' | 'datasetId' | 'workflowId' | 'workflowVersionId' | 'createdAt'
      >
    >,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE evaluation_runs SET status=COALESCE($2,status),started_at=COALESCE($3,started_at),completed_at=COALESCE($4,completed_at),total_cases=COALESCE($5,total_cases),passed_cases=COALESCE($6,passed_cases),failed_cases=COALESCE($7,failed_cases),average_score=COALESCE($8,average_score),average_latency_ms=COALESCE($9,average_latency_ms),p50_latency_ms=COALESCE($10,p50_latency_ms),p95_latency_ms=COALESCE($11,p95_latency_ms),input_tokens=COALESCE($12,input_tokens),output_tokens=COALESCE($13,output_tokens),total_tokens=COALESCE($14,total_tokens),error_code=$15,error_message=$16 WHERE id=$1',
      [
        runId,
        patch.status ?? null,
        patch.startedAt ?? null,
        patch.completedAt ?? null,
        patch.totalCases ?? null,
        patch.passedCases ?? null,
        patch.failedCases ?? null,
        patch.averageScore ?? null,
        patch.averageLatencyMs ?? null,
        patch.p50LatencyMs ?? null,
        patch.p95LatencyMs ?? null,
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.totalTokens ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
      ],
    );
  }
  public async createEvaluationCaseResult(input: {
    evaluationRunId: string;
    evaluationCaseId: string;
  }): Promise<EvaluationCaseResultRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO evaluation_case_results(evaluation_run_id,evaluation_case_id,status) VALUES($1,$2,'RUNNING') RETURNING *",
      [input.evaluationRunId, input.evaluationCaseId],
    );
    return evaluationCaseResultFromRow(rows[0] as Record<string, unknown>);
  }
  public async updateEvaluationCaseResult(
    id: string,
    patch: Partial<
      Omit<EvaluationCaseResultRecord, 'id' | 'evaluationRunId' | 'evaluationCaseId' | 'createdAt'>
    >,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE evaluation_case_results SET workflow_run_id=COALESCE($2,workflow_run_id),status=COALESCE($3,status),actual_output_json=COALESCE($4,actual_output_json),score=COALESCE($5,score),passed=COALESCE($6,passed),latency_ms=COALESCE($7,latency_ms),input_tokens=COALESCE($8,input_tokens),output_tokens=COALESCE($9,output_tokens),error_code=$10,error_message=$11 WHERE id=$1',
      [
        id,
        patch.workflowRunId ?? null,
        patch.status ?? null,
        patch.actualOutput ?? null,
        patch.score ?? null,
        patch.passed ?? null,
        patch.latencyMs ?? null,
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
      ],
    );
  }
  public async listEvaluationCaseResults(
    projectId: string,
    evaluationRunId: string,
  ): Promise<EvaluationCaseResultRecord[] | null> {
    const scoped = await this.getEvaluationRun(projectId, evaluationRunId);
    if (!scoped) return null;
    const { rows } = await this.pool.query(
      'SELECT * FROM evaluation_case_results WHERE evaluation_run_id=$1 ORDER BY created_at',
      [evaluationRunId],
    );
    return rows.map((row) => evaluationCaseResultFromRow(row as Record<string, unknown>));
  }
}
