import { useEffect, useMemo, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type GraphNode,
  type NodeType,
  type Run,
  type Workflow,
  type WorkflowGraph,
} from './api';

interface CanvasData extends Record<string, unknown> {
  nodeType: NodeType;
  label: string;
}
type CanvasNode = Node<CanvasData>;

const nodeLabels: Record<NodeType, string> = {
  INPUT: 'Runtime input',
  PROMPT: 'Prompt template',
  LLM: 'Model generation',
  HUMAN_APPROVAL: 'Human approval',
  OUTPUT: 'Final output',
};

const WorkflowNode = ({ data }: { data: CanvasData }) => (
  <div className={`workflow-node node-${data.nodeType.toLowerCase()}`}>
    {data.nodeType !== 'INPUT' && <Handle type="target" position={Position.Left} />}
    <span>{data.nodeType}</span>
    <strong>{data.label}</strong>
    {data.nodeType !== 'OUTPUT' && <Handle type="source" position={Position.Right} />}
  </div>
);
const nodeTypes = { workflow: WorkflowNode };

export const createWorkflowNode = (
  nodeType: NodeType,
  index: number,
  id: string = crypto.randomUUID(),
): CanvasNode => {
  const config: Record<string, unknown> =
    nodeType === 'PROMPT'
      ? { template: 'Answer this clearly for a beginner: {{input}}' }
      : nodeType === 'LLM'
        ? { provider: 'configured-default', model: 'configured-default', temperature: 0 }
        : nodeType === 'HUMAN_APPROVAL'
          ? {
              title: 'Approve generated response',
              instructions: 'Review generated response before continuing.',
              allow_reject: true,
            }
          : {};
  return {
    id,
    type: 'workflow',
    position: { x: 80 + index * 190, y: 160 },
    data: { nodeType, label: nodeLabels[nodeType], config },
  };
};

export const pollingIntervalForStatus = (status: Run['status'] | undefined): number | false =>
  status === 'QUEUED' || status === 'RUNNING' || status === 'WAITING_FOR_APPROVAL' ? 800 : false;

const toCanvasNode = (node: GraphNode): CanvasNode => ({
  id: node.id,
  type: 'workflow',
  position: node.position,
  data: { nodeType: node.type, label: nodeLabels[node.type], config: node.config },
});
export const graphFromCanvas = (nodes: CanvasNode[], edges: Edge[]): WorkflowGraph => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    version: 1,
    position: node.position,
    config: (node.data.config as Record<string, unknown> | undefined) ?? {},
  })),
  edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
});

export interface WorkflowEditorProps {
  projectId: string;
  workflow: Workflow;
  onBack(): void;
}

export function WorkflowEditor({ projectId, workflow, onBack }: WorkflowEditorProps) {
  const initialGraph = workflow.draftGraph ?? { nodes: [], edges: [] };
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    initialGraph.nodes.map(toCanvasNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialGraph.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('Add four nodes, connect them, then validate.');
  const [runInput, setRunInput] = useState('Explain Docker simply');
  const [run, setRun] = useState<Run | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [readOnlyVersion, setReadOnlyVersion] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const graph = useMemo(() => graphFromCanvas(nodes, edges), [nodes, edges]);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const prompts = useQuery({
    queryKey: ['prompts', projectId],
    queryFn: () => api.listPrompts(projectId),
  });
  const promptVersions =
    prompts.data?.flatMap((prompt) =>
      prompt.versions.map((version) => ({ ...version, promptName: prompt.name })),
    ) ?? [];
  const versions = useQuery({
    queryKey: ['versions', projectId, workflow.id],
    queryFn: () => api.listVersions(projectId, workflow.id),
  });
  const runQuery = useQuery({
    queryKey: ['run', projectId, workflow.id, run?.id],
    queryFn: () => api.getRun(projectId, workflow.id, run?.id ?? ''),
    enabled: Boolean(run?.id),
    refetchInterval: (query) => {
      const status = (query.state.data as Run | undefined)?.status ?? run?.status;
      return pollingIntervalForStatus(status);
    },
  });
  const currentRun = runQuery.data ?? run;
  const trace = useQuery({
    queryKey: ['trace', projectId, workflow.id, currentRun?.id],
    queryFn: () => api.getTrace(projectId, workflow.id, currentRun?.id ?? ''),
    enabled: Boolean(currentRun?.id),
    refetchInterval:
      currentRun?.status === 'QUEUED' ||
      currentRun?.status === 'RUNNING' ||
      currentRun?.status === 'WAITING_FOR_APPROVAL'
        ? 800
        : false,
  });

  useEffect(() => {
    if (runQuery.data) setRun(runQuery.data);
  }, [runQuery.data]);
  useEffect(() => {
    if (!selectedVersionId && versions.data?.[0]) setSelectedVersionId(versions.data[0].id);
  }, [selectedVersionId, versions.data]);

  const save = useMutation({
    mutationFn: () => api.saveWorkflow(projectId, workflow, graph),
    onSuccess: () => setMessage('Draft saved.'),
    onError: (error) => setMessage(error.message),
  });
  const validate = useMutation({
    mutationFn: () => api.validateWorkflow(projectId, workflow.id, graph),
    onSuccess: () => setMessage('Workflow is valid and has a deterministic execution order.'),
    onError: (error) => setMessage(error.message),
  });
  const createVersion = useMutation({
    mutationFn: () => api.createVersion(projectId, workflow.id, graph),
    onSuccess: async (version) => {
      setMessage(`Immutable Version ${version.versionNumber} created.`);
      await queryClient.invalidateQueries({ queryKey: ['versions', projectId, workflow.id] });
    },
    onError: (error) => setMessage(error.message),
  });
  const startRun = useMutation({
    mutationFn: async () => {
      const version =
        versions.data?.find((item) => item.id === selectedVersionId) ?? versions.data?.[0];
      if (!version) throw new Error('Create a workflow version before running.');
      return api.createRun(projectId, workflow.id, version.id, runInput);
    },
    onSuccess: (created) => {
      setRun(created);
      setMessage(`Run ${created.id} queued.`);
    },
    onError: (error) => setMessage(error.message),
  });

  const cancelRun = useMutation({
    mutationFn: () => api.cancelRun(projectId, workflow.id, currentRun?.id ?? ''),
    onSuccess: (updated) => {
      setRun(updated);
      setMessage('Run cancellation requested.');
    },
    onError: (error) => setMessage(error.message),
  });
  const addNode = (nodeType: NodeType) => {
    const node = createWorkflowNode(nodeType, nodes.length);
    const preferredPromptVersion = promptVersions[0];
    if (nodeType === 'PROMPT' && preferredPromptVersion) {
      node.data.config = { prompt_version_id: preferredPromptVersion.id };
      node.data.label = `${preferredPromptVersion.promptName} v${preferredPromptVersion.versionNumber}`;
    }
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };
  const updateConfig = (key: string, value: string | number | boolean) => {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  ...((node.data.config as Record<string, unknown> | undefined) ?? {}),
                  [key]: value,
                },
              },
            }
          : node,
      ),
    );
  };
  const replaceSelectedConfig = (config: Record<string, unknown>, label?: string) => {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? { ...node, data: { ...node.data, config, label: label ?? node.data.label } }
          : node,
      ),
    );
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
    );
    setSelectedId(null);
  };

  return (
    <main className="editor-page">
      <div className="editor-heading">
        <button className="ghost" onClick={onBack}>
          ← Workflows
        </button>
        <div>
          <span className="eyebrow">WORKFLOW EDITOR</span>
          <h1>{workflow.name}</h1>
        </div>
        <span className="provider-badge">Development Provider</span>
      </div>
      <div className="editor-layout">
        <aside className="palette">
          <h2>Nodes</h2>
          {(['INPUT', 'PROMPT', 'LLM', 'HUMAN_APPROVAL', 'OUTPUT'] as NodeType[]).map((type) => (
            <button key={type} onClick={() => addNode(type)}>
              + {type}
            </button>
          ))}
          <hr />
          <button disabled={!selected || readOnlyVersion !== null} onClick={deleteSelected}>
            Delete selected
          </button>
        </aside>
        <section className="canvas" aria-label="Workflow canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection: Connection) =>
              setEdges((current) => addEdge(connection, current))
            }
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </section>
        <aside className="inspector">
          <h2>Configuration</h2>
          {!selected && <p>Select a node.</p>}
          {selected?.data.nodeType === 'PROMPT' && (
            <>
              <label>
                Prompt version (preferred)
                <select
                  aria-label="Prompt version"
                  value={String(
                    (selected.data.config as Record<string, unknown>).prompt_version_id ?? '',
                  )}
                  onChange={(event) => {
                    const version = promptVersions.find((item) => item.id === event.target.value);
                    if (version)
                      replaceSelectedConfig(
                        { prompt_version_id: version.id },
                        `${version.promptName} v${version.versionNumber}`,
                      );
                    else
                      replaceSelectedConfig(
                        { template: 'Answer this clearly: {{input}}' },
                        nodeLabels.PROMPT,
                      );
                  }}
                >
                  <option value="">Inline legacy prompt</option>
                  {promptVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.promptName} ? v{version.versionNumber}
                    </option>
                  ))}
                </select>
              </label>
              {'template' in (selected.data.config as Record<string, unknown>) && (
                <label>
                  Inline template (Milestone 1 compatibility)
                  <textarea
                    value={String((selected.data.config as Record<string, unknown>).template ?? '')}
                    onChange={(event) => updateConfig('template', event.target.value)}
                  />
                </label>
              )}
              {'prompt_version_id' in (selected.data.config as Record<string, unknown>) && (
                <p className="validation-message">
                  This workflow will pin the selected immutable PromptVersion.
                </p>
              )}
            </>
          )}
          {selected?.data.nodeType === 'LLM' && (
            <>
              <label>
                Model
                <input
                  value={String((selected.data.config as Record<string, unknown>).model ?? '')}
                  onChange={(event) => updateConfig('model', event.target.value)}
                />
              </label>
              <label>
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={Number((selected.data.config as Record<string, unknown>).temperature ?? 0)}
                  onChange={(event) => updateConfig('temperature', Number(event.target.value))}
                />
              </label>
            </>
          )}
          {selected?.data.nodeType === 'HUMAN_APPROVAL' && (
            <>
              <label>
                Approval title
                <input
                  value={String((selected.data.config as Record<string, unknown>).title ?? '')}
                  onChange={(event) => updateConfig('title', event.target.value)}
                />
              </label>
              <label>
                Instructions
                <textarea
                  value={String(
                    (selected.data.config as Record<string, unknown>).instructions ?? '',
                  )}
                  onChange={(event) => updateConfig('instructions', event.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(
                    (selected.data.config as Record<string, unknown>).allow_reject ?? true,
                  )}
                  onChange={(event) => updateConfig('allow_reject', event.target.checked)}
                />{' '}
                Allow rejection
              </label>
            </>
          )}{' '}
          <div className="action-stack">
            <button disabled={readOnlyVersion !== null} onClick={() => save.mutate()}>
              Save draft
            </button>
            <button disabled={readOnlyVersion !== null} onClick={() => validate.mutate()}>
              Validate
            </button>
            <button disabled={readOnlyVersion !== null} onClick={() => createVersion.mutate()}>
              Create Version
            </button>
          </div>
          <div className="validation-message" role="status">
            {message}
          </div>
        </aside>
      </div>
      <section className="run-panel">
        <div>
          <span className="eyebrow">IMMUTABLE VERSIONS</span>
          <h2>
            {readOnlyVersion
              ? `Viewing Version ${readOnlyVersion} (read only)`
              : 'Workflow versions'}
          </h2>
          <div className="version-list">
            {versions.data?.map((version) => (
              <button
                className="ghost"
                key={version.id}
                onClick={() => {
                  setSelectedVersionId(version.id);
                  setReadOnlyVersion(version.versionNumber);
                  setNodes(version.graph.nodes.map(toCanvasNode));
                  setEdges(version.graph.edges);
                }}
              >
                Version {version.versionNumber}
              </button>
            ))}
            {readOnlyVersion && (
              <button
                className="ghost"
                onClick={() => {
                  setReadOnlyVersion(null);
                  setNodes(initialGraph.nodes.map(toCanvasNode));
                  setEdges(initialGraph.edges);
                }}
              >
                Return to draft
              </button>
            )}
          </div>
        </div>
        <div className="run-form">
          <select
            aria-label="Workflow version"
            value={selectedVersionId ?? ''}
            onChange={(event) => setSelectedVersionId(event.target.value)}
          >
            {versions.data?.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.versionNumber}
              </option>
            ))}
          </select>
          <input
            aria-label="Run input"
            value={runInput}
            onChange={(event) => setRunInput(event.target.value)}
          />
          <button onClick={() => startRun.mutate()}>Run Workflow</button>
        </div>
      </section>
      {currentRun && (
        <section className="result-grid">
          <article>
            <span className={`run-status status-${currentRun.status.toLowerCase()}`}>
              {currentRun.status}
            </span>
            <h2>Run result</h2>
            <p>
              Attempt {currentRun.attemptCount} of {currentRun.maxAttempts}
            </p>
            {['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'].includes(currentRun.status) && (
              <button className="ghost" onClick={() => cancelRun.mutate()}>
                Cancel run
              </button>
            )}
            <code>{currentRun.id}</code>
            {currentRun.output && (
              <pre>
                {String(currentRun.output.text ?? JSON.stringify(currentRun.output, null, 2))}
              </pre>
            )}
            {currentRun.status === 'WAITING_FOR_APPROVAL' && (
              <p className="validation-message">
                <strong>WAITING FOR APPROVAL</strong>
                <br />
                Open the Approvals inbox to approve or reject this run.
              </p>
            )}
            {currentRun.errorMessage && <p className="error">{currentRun.errorMessage}</p>}
          </article>
          <article>
            <h2>Trace timeline</h2>
            <ol className="timeline">
              {trace.data?.map((event) => (
                <li key={event.id}>
                  <strong>{event.eventType}</strong>
                  <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
                  {event.metadata.prompt ? <p>{String(event.metadata.prompt)}</p> : null}
                </li>
              ))}
            </ol>
          </article>
        </section>
      )}
    </main>
  );
}
