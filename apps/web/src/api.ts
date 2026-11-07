export type NodeType = 'INPUT' | 'PROMPT' | 'LLM' | 'OUTPUT';
export interface GraphNode {
  id: string;
  type: NodeType;
  version: 1;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface Project {
  id: string;
  name: string;
  description: string | null;
}
export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  draftGraph: WorkflowGraph | null;
}
export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  graph: WorkflowGraph;
  createdAt: string;
}
export interface PromptVersion {
  id: string;
  promptId: string;
  versionNumber: number;
  template: string;
  variables: string[];
  changeNotes: string | null;
  createdAt: string;
}
export interface Prompt {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  updatedAt: string;
  versions: PromptVersion[];
}
export type EvaluatorConfig =
  | { type: 'EXACT_MATCH' }
  | { type: 'CONTAINS'; values: string[] }
  | { type: 'NOT_CONTAINS'; values: string[] }
  | { type: 'REGEX'; pattern: string; flags: string }
  | { type: 'JSON_SCHEMA'; schema: Record<string, unknown> };
export interface EvaluationCase {
  id: string;
  datasetId: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  evaluatorConfig: EvaluatorConfig;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface EvaluationDataset {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  updatedAt: string;
  cases: EvaluationCase[];
}
export interface NodeRun {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}
export interface Run {
  id: string;
  workflowVersionId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  nodeRuns?: NodeRun[];
}
export interface TraceEvent {
  id: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface EvaluationCaseResult {
  id: string;
  evaluationCaseId: string;
  workflowRunId: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  actualOutput: Record<string, unknown> | null;
  score: number | null;
  passed: boolean | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  evaluationCase: EvaluationCase | null;
}
export interface EvaluationRun {
  id: string;
  projectId: string;
  datasetId: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passPercentage?: number;
  averageScore: number | null;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errorMessage: string | null;
  results?: EvaluationCaseResult[];
  createdAt: string;
}
export interface EvaluationComparisonSummary {
  evaluationRunId: string;
  workflowId: string;
  workflowVersionId: string;
  promptVersionIds: string[];
  passPercentage: number;
  averageScore: number;
  averageLatencyMs: number;
  totalTokens: number;
}
export interface EvaluationComparison {
  datasetId: string;
  runA: EvaluationComparisonSummary;
  runB: EvaluationComparisonSummary;
  deltas: {
    qualityScore: number;
    passPercentagePoints: number;
    latencyMs: number;
    totalTokens: number;
  };
  interpretation: string;
}

const apiOrigin =
  typeof window === 'undefined'
    ? 'http://localhost:3001'
    : `${window.location.protocol}//${window.location.hostname}:3001`;
const baseUrl = `${apiOrigin}/api/v1`;
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: string; details?: string[] };
    throw new Error(
      error.details?.join(' ') ?? error.error ?? `Request failed with HTTP ${response.status}`,
    );
  }
  return data as T;
};
export const workflowTraceUrl = (projectId: string, workflowId: string, runId: string) =>
  `${baseUrl}/projects/${projectId}/workflows/${workflowId}/runs/${runId}/trace`;
export const api = {
  listProjects: () => request<Project[]>('/projects'),
  createProject: (name: string) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  listWorkflows: (projectId: string) => request<Workflow[]>(`/projects/${projectId}/workflows`),
  createWorkflow: (projectId: string, name: string) =>
    request<Workflow>(`/projects/${projectId}/workflows`, {
      method: 'POST',
      body: JSON.stringify({ name, graph: null }),
    }),
  saveWorkflow: (projectId: string, workflow: Workflow, graph: WorkflowGraph) =>
    request<Workflow>(`/projects/${projectId}/workflows/${workflow.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: workflow.name, description: workflow.description, graph }),
    }),
  validateWorkflow: (projectId: string, workflowId: string, graph: WorkflowGraph) =>
    request<{ valid: boolean; errors: string[]; executionOrder: string[] }>(
      `/projects/${projectId}/workflows/${workflowId}/validate`,
      { method: 'POST', body: JSON.stringify(graph) },
    ),
  listVersions: (projectId: string, workflowId: string) =>
    request<WorkflowVersion[]>(`/projects/${projectId}/workflows/${workflowId}/versions`),
  createVersion: (projectId: string, workflowId: string, graph: WorkflowGraph) =>
    request<WorkflowVersion>(`/projects/${projectId}/workflows/${workflowId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ graph }),
    }),
  createRun: (projectId: string, workflowId: string, workflowVersionId: string, input: string) =>
    request<Run>(`/projects/${projectId}/workflows/${workflowId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ workflowVersionId, input: { input } }),
    }),
  getRun: (projectId: string, workflowId: string, runId: string) =>
    request<Run>(`/projects/${projectId}/workflows/${workflowId}/runs/${runId}`),
  getTrace: (projectId: string, workflowId: string, runId: string) =>
    request<TraceEvent[]>(`/projects/${projectId}/workflows/${workflowId}/runs/${runId}/trace`),
  listPrompts: (projectId: string) => request<Prompt[]>(`/projects/${projectId}/prompts`),
  createPrompt: (projectId: string, name: string, description: string | null = null) =>
    request<Prompt>(`/projects/${projectId}/prompts`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  createPromptVersion: (
    projectId: string,
    promptId: string,
    template: string,
    changeNotes: string | null,
  ) =>
    request<PromptVersion>(`/projects/${projectId}/prompts/${promptId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ template, changeNotes }),
    }),
  listDatasets: (projectId: string) =>
    request<EvaluationDataset[]>(`/projects/${projectId}/evaluation-datasets`),
  createDataset: (projectId: string, name: string) =>
    request<EvaluationDataset>(`/projects/${projectId}/evaluation-datasets`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  addEvaluationCase: (
    projectId: string,
    datasetId: string,
    input: Record<string, unknown>,
    expectedOutput: Record<string, unknown>,
    evaluatorConfig: EvaluatorConfig,
  ) =>
    request<EvaluationCase>(`/projects/${projectId}/evaluation-datasets/${datasetId}/cases`, {
      method: 'POST',
      body: JSON.stringify({ input, expectedOutput, evaluatorConfig }),
    }),
  listEvaluationRuns: (projectId: string) =>
    request<EvaluationRun[]>(`/projects/${projectId}/evaluation-runs`),
  createEvaluationRun: (
    projectId: string,
    datasetId: string,
    workflowId: string,
    workflowVersionId: string,
  ) =>
    request<EvaluationRun>(`/projects/${projectId}/evaluation-runs`, {
      method: 'POST',
      body: JSON.stringify({ datasetId, workflowId, workflowVersionId }),
    }),
  getEvaluationRun: (projectId: string, runId: string) =>
    request<EvaluationRun>(`/projects/${projectId}/evaluation-runs/${runId}`),
  compareEvaluationRuns: (projectId: string, evaluationRunIdA: string, evaluationRunIdB: string) =>
    request<EvaluationComparison>(`/projects/${projectId}/evaluation-comparisons`, {
      method: 'POST',
      body: JSON.stringify({ evaluationRunIdA, evaluationRunIdB }),
    }),
};
