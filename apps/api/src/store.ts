import type { WorkflowGraph, NodeRunStatus, RunStatus } from '@agentops/contracts';
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
export interface TraceEventRecord {
  id: string;
  runId: string;
  nodeRunId: string | null;
  eventType: string;
  metadata: Record<string, unknown>;
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
  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        'status' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<void>;
  createNodeRun(input: { runId: string; nodeId: string; nodeType: string }): Promise<NodeRunRecord>;
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
const traceFromRow = (row: Record<string, unknown>): TraceEventRecord => ({
  id: String(row.id),
  runId: String(row.run_id),
  nodeRunId: row.node_run_id === null ? null : String(row.node_run_id),
  eventType: String(row.event_type),
  metadata: row.metadata as Record<string, unknown>,
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
  public async updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        'status' | 'output' | 'errorCode' | 'errorMessage' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE runs SET status=COALESCE($2,status),output_json=COALESCE($3,output_json),error_code=$4,error_message=$5,started_at=COALESCE($6,started_at),completed_at=COALESCE($7,completed_at) WHERE id=$1',
      [
        runId,
        patch.status ?? null,
        patch.output ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        patch.startedAt ?? null,
        patch.completedAt ?? null,
      ],
    );
  }
  public async createNodeRun(input: {
    runId: string;
    nodeId: string;
    nodeType: string;
  }): Promise<NodeRunRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO node_runs(run_id,node_id,node_type,status) VALUES($1,$2,$3,'PENDING') RETURNING *",
      [input.runId, input.nodeId, input.nodeType],
    );
    return nodeRunFromRow(rows[0] as Record<string, unknown>);
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
}
