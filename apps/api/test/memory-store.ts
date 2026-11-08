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
  }) {
    const existing = this.approvals.find((item) => item.nodeRunId === input.nodeRunId);
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
