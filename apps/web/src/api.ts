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

const baseUrl =
  typeof window === 'undefined'
    ? 'http://localhost:3001/api/v1'
    : `${window.location.protocol}//${window.location.hostname}:3001/api/v1`;

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
};
