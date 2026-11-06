import { randomUUID } from 'node:crypto';
import type { WorkflowGraph } from '@agentops/contracts';
import type {
  NodeRunRecord,
  ProjectRecord,
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
  async updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        'status' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ) {
    const item = this.runs.find((r) => r.id === runId);
    if (item) Object.assign(item, patch);
  }
  async createNodeRun(input: { runId: string; nodeId: string; nodeType: string }) {
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
}
