import { randomUUID } from 'node:crypto';
import type { WorkflowGraph } from '@agentops/contracts';
import type {
  ApprovalRequestRecord,
  NodeRunRecord,
  ProjectRecord,
  PromptRecord,
  PromptVersionRecord,
  EvaluationDatasetRecord,
  EvaluationCaseRecord,
  EvaluationRunRecord,
  EvaluationCaseResultRecord,
  RunRecord,
  Store,
  TraceEventRecord,
  WorkflowRecord,
  WorkflowVersionRecord,
  KnowledgeSourceRecord,
  KnowledgeDocumentRecord,
  KnowledgeChunkRecord,
  CitationValidationRecord,
  AgentExecutionRecord,
  AgentStepRecord,
  ToolCallRecord,
} from '../src/store.js';

const now = () => new Date().toISOString();
export class MemoryStore implements Store {
  public projects: ProjectRecord[] = [];
  public workflows: WorkflowRecord[] = [];
  public versions: WorkflowVersionRecord[] = [];
  public runs: RunRecord[] = [];
  public nodeRuns: NodeRunRecord[] = [];
  public traces: TraceEventRecord[] = [];
  public approvals: ApprovalRequestRecord[] = [];
  public prompts: PromptRecord[] = [];
  public promptVersions: PromptVersionRecord[] = [];
  public evaluationDatasets: EvaluationDatasetRecord[] = [];
  public evaluationCases: EvaluationCaseRecord[] = [];
  public evaluationRuns: EvaluationRunRecord[] = [];
  public evaluationCaseResults: EvaluationCaseResultRecord[] = [];
  public knowledgeSources: KnowledgeSourceRecord[] = [];
  public knowledgeDocuments: KnowledgeDocumentRecord[] = [];
  public knowledgeChunks: KnowledgeChunkRecord[] = [];
  public chunkEmbeddings = new Map<
    string,
    { embedding: number[]; provider: string; model: string; dimensions: number }
  >();
  public citationValidations: CitationValidationRecord[] = [];
  public agentExecutions: AgentExecutionRecord[] = [];
  public agentSteps: AgentStepRecord[] = [];
  public toolCalls: ToolCallRecord[] = [];
  async createProject(input: { name: string; description: string | null }) {
    const item = { id: randomUUID(), ...input, createdAt: now(), updatedAt: now() };
    this.projects.push(item);
    return item;
  }
  async listProjects() {
    return this.projects;
  }
  async getProject(id: string) {
    return this.projects.find((item) => item.id === id) ?? null;
  }
  async createWorkflow(
    projectId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ) {
    if (!(await this.getProject(projectId))) return null;
    const item = { id: randomUUID(), projectId, ...input, createdAt: now(), updatedAt: now() };
    this.workflows.push(item);
    return item;
  }
  async listWorkflows(projectId: string) {
    return this.workflows.filter((item) => item.projectId === projectId);
  }
  async getWorkflow(projectId: string, workflowId: string) {
    return (
      this.workflows.find((item) => item.projectId === projectId && item.id === workflowId) ?? null
    );
  }
  async updateWorkflow(
    projectId: string,
    workflowId: string,
    input: { name: string; description: string | null; draftGraph: WorkflowGraph | null },
  ) {
    const item = await this.getWorkflow(projectId, workflowId);
    if (!item) return null;
    Object.assign(item, input, { updatedAt: now() });
    return item;
  }
  async createVersion(projectId: string, workflowId: string, graph: WorkflowGraph) {
    if (!(await this.getWorkflow(projectId, workflowId))) return null;
    const item = {
      id: randomUUID(),
      workflowId,
      versionNumber: this.versions.filter((v) => v.workflowId === workflowId).length + 1,
      graph: structuredClone(graph),
      createdAt: now(),
    };
    this.versions.push(item);
    return item;
  }
  async listVersions(projectId: string, workflowId: string) {
    if (!(await this.getWorkflow(projectId, workflowId))) return [];
    return this.versions
      .filter((v) => v.workflowId === workflowId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }
  async getVersion(projectId: string, workflowId: string, versionId: string) {
    if (!(await this.getWorkflow(projectId, workflowId))) return null;
    return this.versions.find((v) => v.workflowId === workflowId && v.id === versionId) ?? null;
  }
  async getLatestVersion(projectId: string, workflowId: string) {
    return (await this.listVersions(projectId, workflowId))[0] ?? null;
  }
  async createRun(input: {
    projectId: string;
    workflowId: string;
    workflowVersionId: string;
    runtimeInput: Record<string, unknown>;
  }) {
    const item: RunRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      status: 'QUEUED',
      input: input.runtimeInput,
      output: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
      queueJobId: null,
      attemptCount: 0,
      maxAttempts: 3,
      lastAttemptAt: null,
      cancellationRequestedAt: null,
      cancellationReason: null,
    };
    this.runs.push(item);
    return item;
  }
  async listRuns(projectId: string, workflowId: string) {
    return this.runs.filter((r) => r.projectId === projectId && r.workflowId === workflowId);
  }
  async getRun(projectId: string, workflowId: string, runId: string) {
    return (
      this.runs.find(
        (r) => r.projectId === projectId && r.workflowId === workflowId && r.id === runId,
      ) ?? null
    );
  }
  async getRunById(runId: string) {
    return this.runs.find((r) => r.id === runId) ?? null;
  }
  async listRecoverableRuns() {
    return this.runs.filter((r) => ['QUEUED', 'RUNNING'].includes(r.status));
  }
  async updateRun(
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
  ) {
    const item = this.runs.find((r) => r.id === runId);
    if (item) Object.assign(item, patch);
  }
  async createNodeRun(input: { runId: string; nodeId: string; nodeType: string }) {
    const existing = this.nodeRuns.find(
      (item) => item.runId === input.runId && item.nodeId === input.nodeId,
    );
    if (existing) return existing;
    const item: NodeRunRecord = {
      id: randomUUID(),
      ...input,
      status: 'PENDING',
      input: null,
      output: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
    };
    this.nodeRuns.push(item);
    return item;
  }
  async getNodeRun(runId: string, nodeId: string) {
    return this.nodeRuns.find((r) => r.runId === runId && r.nodeId === nodeId) ?? null;
  }
  async updateNodeRun(
    id: string,
    patch: Partial<
      Pick<
        NodeRunRecord,
        'status' | 'input' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ) {
    const item = this.nodeRuns.find((r) => r.id === id);
    if (item) Object.assign(item, patch);
  }
  async listNodeRuns(runId: string) {
    return this.nodeRuns.filter((r) => r.runId === runId);
  }
  async createApproval(input: {
    projectId: string;
    runId: string;
    nodeRunId: string;
    title: string;
    instructions: string;
    approvalType?: 'HUMAN_NODE' | 'AGENT_TOOL';
    toolCallId?: string;
    safeContext?: Record<string, unknown>;
  }) {
    const existing = this.approvals.find((item) =>
      input.toolCallId
        ? item.toolCallId === input.toolCallId
        : item.nodeRunId === input.nodeRunId && item.approvalType === 'HUMAN_NODE',
    );
    if (existing) return existing;
    const item: ApprovalRequestRecord = {
      id: randomUUID(),
      ...input,
      status: 'PENDING',
      requestedAt: now(),
      decidedAt: null,
      decision: null,
      reviewerId: null,
      reviewerLabel: null,
      reason: null,
      createdAt: now(),
      updatedAt: now(),
      approvalType: input.approvalType ?? 'HUMAN_NODE',
      toolCallId: input.toolCallId ?? null,
      safeContext: input.safeContext ?? {},
    };
    this.approvals.push(item);
    return item;
  }
  async listApprovals(projectId: string) {
    return this.approvals.filter((item) => item.projectId === projectId);
  }
  async getApproval(projectId: string, approvalId: string) {
    return (
      this.approvals.find((item) => item.projectId === projectId && item.id === approvalId) ?? null
    );
  }
  async getApprovalForNodeRun(nodeRunId: string) {
    return this.approvals.find((item) => item.nodeRunId === nodeRunId) ?? null;
  }
  async decideApproval(
    projectId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    reason: string | null,
  ) {
    const item = this.approvals.find(
      (value) =>
        value.projectId === projectId && value.id === approvalId && value.status === 'PENDING',
    );
    if (!item) return null;
    Object.assign(item, {
      status: decision,
      decision,
      reason,
      reviewerLabel: 'demo-reviewer',
      decidedAt: now(),
      updatedAt: now(),
    });
    return item;
  }
  async createAgentExecution(input: {
    projectId: string;
    runId: string;
    nodeRunId: string;
    model: string;
    maxSteps: number;
    maxDurationMs: number;
    maxToolCalls: number;
    maxTotalTokens: number;
  }) {
    const found = this.agentExecutions.find((x) => x.nodeRunId === input.nodeRunId);
    if (found) return found;
    const item: AgentExecutionRecord = {
      id: randomUUID(),
      ...input,
      status: 'RUNNING',
      stepsUsed: 0,
      toolCallsUsed: 0,
      totalTokens: 0,
      activeDurationMs: 0,
      limitReason: null,
      startedAt: now(),
      completedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.agentExecutions.push(item);
    return item;
  }
  async getAgentExecution(nodeRunId: string) {
    return this.agentExecutions.find((x) => x.nodeRunId === nodeRunId) ?? null;
  }
  async updateAgentExecution(id: string, patch: Partial<AgentExecutionRecord>) {
    const x = this.agentExecutions.find((v) => v.id === id);
    if (x) Object.assign(x, patch, { updatedAt: now() });
  }
  async createAgentStep(input: {
    agentExecutionId: string;
    stepNumber: number;
    input: Record<string, unknown>;
  }) {
    const found = this.agentSteps.find(
      (x) => x.agentExecutionId === input.agentExecutionId && x.stepNumber === input.stepNumber,
    );
    if (found) return found;
    const item: AgentStepRecord = {
      id: randomUUID(),
      ...input,
      actionType: null,
      toolName: null,
      actionSummary: null,
      output: null,
      status: 'RUNNING',
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      startedAt: now(),
      completedAt: null,
      createdAt: now(),
    };
    this.agentSteps.push(item);
    return item;
  }
  async listAgentSteps(agentExecutionId: string) {
    return this.agentSteps
      .filter((x) => x.agentExecutionId === agentExecutionId)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }
  async updateAgentStep(id: string, patch: Partial<AgentStepRecord>) {
    const x = this.agentSteps.find((v) => v.id === id);
    if (x) Object.assign(x, patch);
  }
  async createToolCall(input: {
    agentStepId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    approvalRequired: boolean;
  }) {
    const found = this.toolCalls.find((x) => x.agentStepId === input.agentStepId);
    if (found) return found;
    const item: ToolCallRecord = {
      id: randomUUID(),
      ...input,
      result: null,
      status: 'PROPOSED',
      approvalRequestId: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
    };
    this.toolCalls.push(item);
    return item;
  }
  async getToolCall(agentStepId: string) {
    return this.toolCalls.find((x) => x.agentStepId === agentStepId) ?? null;
  }
  async updateToolCall(id: string, patch: Partial<ToolCallRecord>) {
    const x = this.toolCalls.find((v) => v.id === id);
    if (x) Object.assign(x, patch);
  }
  async addTrace(input: {
    runId: string;
    nodeRunId: string | null;
    eventType: string;
    metadata: Record<string, unknown>;
  }) {
    const item = { id: randomUUID(), ...input, createdAt: now() };
    this.traces.push(item);
    return item;
  }
  async listTrace(projectId: string, workflowId: string, runId: string) {
    if (!(await this.getRun(projectId, workflowId, runId))) return null;
    return this.traces.filter((e) => e.runId === runId);
  }
  async createKnowledgeSource(
    projectId: string,
    input: {
      name: string;
      description: string | null;
      embeddingProvider: 'development' | 'openai';
      embeddingModel: string;
    },
  ) {
    if (!(await this.getProject(projectId))) return null;
    const item: KnowledgeSourceRecord = {
      id: randomUUID(),
      projectId,
      ...input,
      sourceType: 'DOCUMENTS',
      embeddingDimensions: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.knowledgeSources.push(item);
    return item;
  }
  async listKnowledgeSources(projectId: string) {
    return this.knowledgeSources.filter((item) => item.projectId === projectId);
  }
  async getKnowledgeSource(projectId: string, sourceId: string) {
    return (
      this.knowledgeSources.find((item) => item.projectId === projectId && item.id === sourceId) ??
      null
    );
  }
  async createKnowledgeDocument(input: {
    projectId: string;
    knowledgeSourceId: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    sha256Hash: string;
    rawContent: Buffer;
  }) {
    if (!(await this.getKnowledgeSource(input.projectId, input.knowledgeSourceId))) return null;
    const existing = this.knowledgeDocuments.find(
      (item) =>
        item.knowledgeSourceId === input.knowledgeSourceId && item.sha256Hash === input.sha256Hash,
    );
    if (existing) return { document: existing, created: false };
    const item: KnowledgeDocumentRecord = {
      id: randomUUID(),
      ...input,
      status: 'UPLOADED',
      errorMessage: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.knowledgeDocuments.push(item);
    return { document: item, created: true };
  }
  async listKnowledgeDocuments(projectId: string, sourceId: string) {
    return this.knowledgeDocuments.filter(
      (item) => item.projectId === projectId && item.knowledgeSourceId === sourceId,
    );
  }
  async getKnowledgeDocument(projectId: string, sourceId: string, documentId: string) {
    return (
      this.knowledgeDocuments.find(
        (item) =>
          item.projectId === projectId &&
          item.knowledgeSourceId === sourceId &&
          item.id === documentId,
      ) ?? null
    );
  }
  async getKnowledgeDocumentById(documentId: string) {
    return this.knowledgeDocuments.find((item) => item.id === documentId) ?? null;
  }
  async listRecoverableKnowledgeDocuments() {
    return this.knowledgeDocuments.filter((item) =>
      ['UPLOADED', 'PROCESSING'].includes(item.status),
    );
  }
  async updateKnowledgeDocument(
    documentId: string,
    patch: { status: KnowledgeDocumentRecord['status']; errorMessage?: string | null },
  ) {
    const item = await this.getKnowledgeDocumentById(documentId);
    if (item)
      Object.assign(item, {
        status: patch.status,
        errorMessage: patch.errorMessage ?? null,
        updatedAt: now(),
      });
  }
  async replaceDocumentChunks(input: {
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
  }) {
    const source = await this.getKnowledgeSource(
      input.document.projectId,
      input.document.knowledgeSourceId,
    );
    if (!source) throw new Error('KnowledgeSource is unavailable in the document project.');
    if (source.embeddingProvider !== input.provider || source.embeddingModel !== input.model)
      throw new Error('Embedding provider or model does not match the KnowledgeSource.');
    if (source.embeddingDimensions !== null && source.embeddingDimensions !== input.dimensions)
      throw new Error('Embedding dimensions do not match existing source embeddings.');
    if (input.chunks.some((chunk) => chunk.embedding.length !== input.dimensions))
      throw new Error('Embedding dimensions are inconsistent.');
    const removed = this.knowledgeChunks.filter(
      (item) => item.knowledgeDocumentId === input.document.id,
    );
    for (const item of removed) this.chunkEmbeddings.delete(item.id);
    this.knowledgeChunks = this.knowledgeChunks.filter(
      (item) => item.knowledgeDocumentId !== input.document.id,
    );
    for (const chunk of input.chunks) {
      const item: KnowledgeChunkRecord = {
        id: randomUUID(),
        knowledgeSourceId: input.document.knowledgeSourceId,
        knowledgeDocumentId: input.document.id,
        projectId: input.document.projectId,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        content: chunk.content,
        metadata: structuredClone(chunk.metadata),
        createdAt: now(),
      };
      this.knowledgeChunks.push(item);
      this.chunkEmbeddings.set(item.id, {
        embedding: [...chunk.embedding],
        provider: input.provider,
        model: input.model,
        dimensions: input.dimensions,
      });
    }
    source.embeddingDimensions = input.dimensions;
    source.updatedAt = now();
    await this.updateKnowledgeDocument(input.document.id, { status: 'READY' });
  }
  async listKnowledgeChunks(projectId: string, sourceId: string, documentId?: string) {
    return this.knowledgeChunks.filter(
      (item) =>
        item.projectId === projectId &&
        item.knowledgeSourceId === sourceId &&
        (!documentId || item.knowledgeDocumentId === documentId),
    );
  }
  async searchKnowledgeChunks(input: {
    projectId: string;
    sourceId: string;
    provider: string;
    model: string;
    dimensions: number;
    queryEmbedding: number[];
    topK: number;
    documentId?: string;
  }) {
    const cosine = (left: number[], right: number[]) => {
      const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
      const a = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
      const b = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
      return a && b ? dot / (a * b) : 0;
    };
    return this.knowledgeChunks
      .filter(
        (chunk) =>
          chunk.projectId === input.projectId &&
          chunk.knowledgeSourceId === input.sourceId &&
          (!input.documentId || chunk.knowledgeDocumentId === input.documentId),
      )
      .flatMap((chunk) => {
        const embedding = this.chunkEmbeddings.get(chunk.id);
        if (
          !embedding ||
          embedding.provider !== input.provider ||
          embedding.model !== input.model ||
          embedding.dimensions !== input.dimensions
        )
          return [];
        const document = this.knowledgeDocuments.find(
          (item) => item.id === chunk.knowledgeDocumentId,
        );
        return [
          {
            ...chunk,
            filename: document?.originalFilename ?? 'unknown',
            similarity: cosine(input.queryEmbedding, embedding.embedding),
          },
        ];
      })
      .sort((a, b) => b.similarity - a.similarity || a.chunkIndex - b.chunkIndex)
      .slice(0, input.topK);
  }
  async createCitationValidation(input: {
    runId: string;
    nodeRunId: string;
    retrievedChunkIds: string[];
    citedChunkIds: string[];
    sourceMetadata: Array<Record<string, unknown>>;
  }) {
    const item: CitationValidationRecord = { id: randomUUID(), ...input, createdAt: now() };
    this.citationValidations.push(item);
    return item;
  }
  async createPrompt(projectId: string, input: { name: string; description: string | null }) {
    if (!(await this.getProject(projectId))) return null;
    const item: PromptRecord = {
      id: randomUUID(),
      projectId,
      ...input,
      createdAt: now(),
      updatedAt: now(),
    };
    this.prompts.push(item);
    return item;
  }
  async listPrompts(projectId: string) {
    return this.prompts.filter((item) => item.projectId === projectId);
  }
  async getPrompt(projectId: string, promptId: string) {
    return (
      this.prompts.find((item) => item.projectId === projectId && item.id === promptId) ?? null
    );
  }
  async createPromptVersion(
    projectId: string,
    promptId: string,
    input: { template: string; variables: string[]; changeNotes: string | null },
  ) {
    const prompt = await this.getPrompt(projectId, promptId);
    if (!prompt) return null;
    const item: PromptVersionRecord = {
      id: randomUUID(),
      promptId,
      versionNumber:
        this.promptVersions.filter((version) => version.promptId === promptId).length + 1,
      ...structuredClone(input),
      createdAt: now(),
    };
    this.promptVersions.push(item);
    prompt.updatedAt = now();
    return item;
  }
  async listPromptVersions(projectId: string, promptId: string) {
    if (!(await this.getPrompt(projectId, promptId))) return [];
    return this.promptVersions
      .filter((item) => item.promptId === promptId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }
  async getPromptVersion(projectId: string, promptId: string, versionId: string) {
    if (!(await this.getPrompt(projectId, promptId))) return null;
    return (
      this.promptVersions.find((item) => item.promptId === promptId && item.id === versionId) ??
      null
    );
  }
  async getPromptVersionById(projectId: string, versionId: string) {
    const version = this.promptVersions.find((item) => item.id === versionId);
    if (!version) return null;
    return (await this.getPrompt(projectId, version.promptId)) ? version : null;
  }
  async createEvaluationDataset(
    projectId: string,
    input: { name: string; description: string | null },
  ) {
    if (!(await this.getProject(projectId))) return null;
    const item: EvaluationDatasetRecord = {
      id: randomUUID(),
      projectId,
      ...input,
      createdAt: now(),
      updatedAt: now(),
    };
    this.evaluationDatasets.push(item);
    return item;
  }
  async listEvaluationDatasets(projectId: string) {
    return this.evaluationDatasets.filter((item) => item.projectId === projectId);
  }
  async getEvaluationDataset(projectId: string, datasetId: string) {
    return (
      this.evaluationDatasets.find(
        (item) => item.projectId === projectId && item.id === datasetId,
      ) ?? null
    );
  }
  async createEvaluationCase(
    projectId: string,
    datasetId: string,
    input: Omit<EvaluationCaseRecord, 'id' | 'datasetId' | 'createdAt'>,
  ) {
    const dataset = await this.getEvaluationDataset(projectId, datasetId);
    if (!dataset) return null;
    const item: EvaluationCaseRecord = {
      id: randomUUID(),
      datasetId,
      ...structuredClone(input),
      createdAt: now(),
    };
    this.evaluationCases.push(item);
    dataset.updatedAt = now();
    return item;
  }
  async listEvaluationCases(projectId: string, datasetId: string) {
    if (!(await this.getEvaluationDataset(projectId, datasetId))) return [];
    return this.evaluationCases.filter((item) => item.datasetId === datasetId);
  }
  async createEvaluationRun(input: {
    projectId: string;
    datasetId: string;
    workflowId: string;
    workflowVersionId: string;
    totalCases: number;
  }) {
    const item: EvaluationRunRecord = {
      id: randomUUID(),
      ...input,
      status: 'QUEUED',
      startedAt: null,
      completedAt: null,
      passedCases: 0,
      failedCases: 0,
      averageScore: null,
      averageLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: now(),
    };
    this.evaluationRuns.push(item);
    return item;
  }
  async listEvaluationRuns(projectId: string) {
    return this.evaluationRuns.filter((item) => item.projectId === projectId);
  }
  async getEvaluationRun(projectId: string, runId: string) {
    return (
      this.evaluationRuns.find((item) => item.projectId === projectId && item.id === runId) ?? null
    );
  }
  async getEvaluationRunById(runId: string) {
    return this.evaluationRuns.find((item) => item.id === runId) ?? null;
  }
  async updateEvaluationRun(
    runId: string,
    patch: Partial<
      Omit<
        EvaluationRunRecord,
        'id' | 'projectId' | 'datasetId' | 'workflowId' | 'workflowVersionId' | 'createdAt'
      >
    >,
  ) {
    const item = this.evaluationRuns.find((candidate) => candidate.id === runId);
    if (item) Object.assign(item, patch);
  }
  async createEvaluationCaseResult(input: { evaluationRunId: string; evaluationCaseId: string }) {
    const item: EvaluationCaseResultRecord = {
      id: randomUUID(),
      ...input,
      workflowRunId: null,
      status: 'RUNNING',
      actualOutput: null,
      score: null,
      passed: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now(),
    };
    this.evaluationCaseResults.push(item);
    return item;
  }
  async updateEvaluationCaseResult(
    id: string,
    patch: Partial<
      Omit<EvaluationCaseResultRecord, 'id' | 'evaluationRunId' | 'evaluationCaseId' | 'createdAt'>
    >,
  ) {
    const item = this.evaluationCaseResults.find((candidate) => candidate.id === id);
    if (item) Object.assign(item, patch);
  }
  async listEvaluationCaseResults(projectId: string, evaluationRunId: string) {
    if (!(await this.getEvaluationRun(projectId, evaluationRunId))) return null;
    return this.evaluationCaseResults.filter((item) => item.evaluationRunId === evaluationRunId);
  }
}
