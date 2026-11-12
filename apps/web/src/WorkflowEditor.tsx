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
  CONDITION: 'Deterministic branch',
  TRANSFORM: 'Structured transform',
  HTTP_REQUEST: 'Safe HTTP request',
  RETRIEVAL: 'Ranked knowledge retrieval',
  OUTPUT: 'Final output',
};

const WorkflowNode = ({ data }: { data: CanvasData }) => (
  <div className={`workflow-node node-${data.nodeType.toLowerCase()}`}>
    {data.nodeType !== 'INPUT' && <Handle type="target" position={Position.Left} />}
    <span>{data.nodeType}</span>
    <strong>{data.label}</strong>
    {data.nodeType === 'CONDITION' ? (
      <>
        <Handle id="true" type="source" position={Position.Right} style={{ top: '38%' }} />
        <Handle id="false" type="source" position={Position.Right} style={{ top: '72%' }} />
        <small className="branch-handle true-handle">TRUE</small>
        <small className="branch-handle false-handle">FALSE</small>
      </>
    ) : (
      data.nodeType !== 'OUTPUT' && <Handle type="source" position={Position.Right} />
    )}
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
          : nodeType === 'CONDITION'
            ? { path: 'text', operator: 'CONTAINS', value: 'approved' }
            : nodeType === 'TRANSFORM'
              ? { output: { text: '{{text}}', status: 'processed' } }
              : nodeType === 'HTTP_REQUEST'
                ? {
                    method: 'GET',
                    url: 'https://example.com',
                    headers: {},
                    timeout_ms: 10000,
                    max_response_bytes: 1048576,
                    retry_non_idempotent: false,
                  }
                : nodeType === 'RETRIEVAL'
                  ? { knowledge_source_id: '', query_path: 'input', top_k: 5 }
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

export const traceSummary = (event: { eventType: string; metadata: Record<string, unknown> }) => {
  if (event.eventType === 'CONDITION_EVALUATED')
    return `result: ${event.metadata.condition_result === true ? 'TRUE' : 'FALSE'}`;
  if (event.eventType === 'BRANCH_SELECTED')
    return `${String(event.metadata.selected_branch).toUpperCase()} branch selected`;
  if (event.eventType === 'NODE_SKIPPED') return 'skipped: branch not selected';
  if (event.eventType.startsWith('HTTP_REQUEST'))
    return [
      event.metadata.method,
      event.metadata.host,
      event.metadata.status,
      event.metadata.latency_ms ? `${event.metadata.latency_ms} ms` : undefined,
      event.metadata.reason,
    ]
      .filter(Boolean)
      .join(' · ');
  if (event.eventType === 'RETRIEVAL_STARTED')
    return `query length ${String(event.metadata.query_length)} / top ${String(event.metadata.top_k)}`;
  if (event.eventType === 'RETRIEVAL_COMPLETED')
    return `${String(event.metadata.result_count)} ranked sources / ${String(event.metadata.latency_ms)} ms`;
  if (event.eventType === 'RETRIEVAL_FAILED') return String(event.metadata.reason ?? 'failed');
  if (event.eventType === 'CITATIONS_VALIDATED')
    return `${Array.isArray(event.metadata.cited_chunk_ids) ? event.metadata.cited_chunk_ids.length : 0} citations validated`;
  return event.metadata.prompt ? String(event.metadata.prompt) : '';
};
export const parseConditionValue = (value: string): string | number | boolean | null => {
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value;
};

const toCanvasNode = (node: GraphNode): CanvasNode => ({
  id: node.id,
  type: 'workflow',
  position: node.position,
  data: { nodeType: node.type, label: nodeLabels[node.type], config: node.config },
});
const toCanvasEdge = (edge: WorkflowGraph['edges'][number]): Edge => ({
  ...edge,
  ...(edge.branch
    ? { sourceHandle: edge.branch, label: edge.branch.toUpperCase(), data: { branch: edge.branch } }
    : {}),
});
export const graphFromCanvas = (nodes: CanvasNode[], edges: Edge[]): WorkflowGraph => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    version: 1,
    position: node.position,
    config: (node.data.config as Record<string, unknown> | undefined) ?? {},
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...((edge.sourceHandle === 'true' || edge.data?.branch === 'true') && {
      branch: 'true' as const,
    }),
    ...((edge.sourceHandle === 'false' || edge.data?.branch === 'false') && {
      branch: 'false' as const,
    }),
  })),
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
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialGraph.edges.map(toCanvasEdge),
  );
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
  const knowledgeSources = useQuery({
    queryKey: ['knowledge-sources', projectId],
    queryFn: () => api.listKnowledgeSources(projectId),
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
    if (nodeType === 'RETRIEVAL' && knowledgeSources.data?.[0]) {
      node.data.config = {
        knowledge_source_id: knowledgeSources.data[0].id,
        query_path: 'input',
        top_k: 5,
      };
      node.data.label = knowledgeSources.data[0].name;
    }
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };
  const updateConfig = (key: string, value: unknown) => {
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
          {(
            [
              'INPUT',
              'PROMPT',
              'LLM',
              'HUMAN_APPROVAL',
              'CONDITION',
              'TRANSFORM',
              'HTTP_REQUEST',
              'RETRIEVAL',
              'OUTPUT',
            ] as NodeType[]
          ).map((type) => (
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
            onConnect={(connection: Connection) => {
              const branch =
                connection.sourceHandle === 'true' || connection.sourceHandle === 'false'
                  ? connection.sourceHandle
                  : undefined;
              setEdges((current) =>
                addEdge(
                  {
                    ...connection,
                    ...(branch ? { label: branch.toUpperCase(), data: { branch } } : {}),
                  },
                  current,
                ),
              );
            }}
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
          )}
          {selected?.data.nodeType === 'CONDITION' && (
            <>
              <label>
                Field path
                <input
                  aria-label="Condition field path"
                  value={String((selected.data.config as Record<string, unknown>).path ?? '')}
                  onChange={(event) => updateConfig('path', event.target.value)}
                />
              </label>
              <label>
                Operator
                <select
                  aria-label="Condition operator"
                  value={String((selected.data.config as Record<string, unknown>).operator ?? '')}
                  onChange={(event) => updateConfig('operator', event.target.value)}
                >
                  {[
                    'EQUALS',
                    'NOT_EQUALS',
                    'CONTAINS',
                    'NOT_CONTAINS',
                    'EXISTS',
                    'NOT_EXISTS',
                    'GREATER_THAN',
                    'GREATER_THAN_OR_EQUAL',
                    'LESS_THAN',
                    'LESS_THAN_OR_EQUAL',
                    'STARTS_WITH',
                    'ENDS_WITH',
                  ].map((operator) => (
                    <option key={operator}>{operator}</option>
                  ))}
                </select>
              </label>
              <label>
                Comparison value
                <input
                  aria-label="Condition comparison value"
                  value={String((selected.data.config as Record<string, unknown>).value ?? '')}
                  onChange={(event) =>
                    updateConfig('value', parseConditionValue(event.target.value))
                  }
                />
              </label>
              <p className="validation-message">Connect both labeled TRUE and FALSE handles.</p>
            </>
          )}
          {selected?.data.nodeType === 'TRANSFORM' && (
            <label>
              Safe output mapping (JSON/templates)
              <textarea
                aria-label="Transform output mapping"
                key={`${selected.id}-transform`}
                defaultValue={JSON.stringify(
                  (selected.data.config as Record<string, unknown>).output ?? {},
                  null,
                  2,
                )}
                onBlur={(event) => {
                  try {
                    updateConfig(
                      'output',
                      JSON.parse(event.target.value) as Record<string, unknown>,
                    );
                  } catch {
                    setMessage('Transform mapping must be valid JSON.');
                  }
                }}
              />
              <small>Only constants and placeholders such as {'{{text}}'} are executed.</small>
            </label>
          )}
          {selected?.data.nodeType === 'HTTP_REQUEST' && (
            <>
              <label>
                Method
                <select
                  aria-label="HTTP method"
                  value={String((selected.data.config as Record<string, unknown>).method ?? 'GET')}
                  onChange={(event) => updateConfig('method', event.target.value)}
                >
                  {['GET', 'POST', 'PUT', 'PATCH'].map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
              </label>
              <label>
                URL
                <input
                  aria-label="HTTP URL"
                  value={String((selected.data.config as Record<string, unknown>).url ?? '')}
                  onChange={(event) => updateConfig('url', event.target.value)}
                />
              </label>
              <label>
                Headers (JSON; secret values use secret_ref)
                <textarea
                  aria-label="HTTP headers"
                  key={`${selected.id}-headers`}
                  defaultValue={JSON.stringify(
                    (selected.data.config as Record<string, unknown>).headers ?? {},
                    null,
                    2,
                  )}
                  onBlur={(event) => {
                    try {
                      updateConfig(
                        'headers',
                        JSON.parse(event.target.value) as Record<string, unknown>,
                      );
                    } catch {
                      setMessage('HTTP headers must be valid JSON.');
                    }
                  }}
                />
              </label>
              <label>
                Request body (JSON/templates)
                <textarea
                  aria-label="HTTP body"
                  key={`${selected.id}-body`}
                  defaultValue={JSON.stringify(
                    (selected.data.config as Record<string, unknown>).body ?? {},
                    null,
                    2,
                  )}
                  onBlur={(event) => {
                    try {
                      updateConfig(
                        'body',
                        JSON.parse(event.target.value) as Record<string, unknown>,
                      );
                    } catch {
                      setMessage('HTTP body must be valid JSON.');
                    }
                  }}
                />
              </label>
              <label>
                Timeout (milliseconds, max 30000)
                <input
                  aria-label="HTTP timeout"
                  type="number"
                  min="100"
                  max="30000"
                  value={Number(
                    (selected.data.config as Record<string, unknown>).timeout_ms ?? 10000,
                  )}
                  onChange={(event) => updateConfig('timeout_ms', Number(event.target.value))}
                />
              </label>
              <p className="security-warning">
                External HTTP requests are executed by the backend and subject to security
                restrictions. Secret values are never shown here.
              </p>
            </>
          )}{' '}
          {selected?.data.nodeType === 'RETRIEVAL' && (
            <>
              <label>
                Knowledge Source
                <select
                  aria-label="Retrieval knowledge source"
                  value={String(
                    (selected.data.config as Record<string, unknown>).knowledge_source_id ?? '',
                  )}
                  onChange={(event) => updateConfig('knowledge_source_id', event.target.value)}
                >
                  <option value="">Select a source</option>
                  {knowledgeSources.data?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} / {source.embeddingModel}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Query path
                <input
                  aria-label="Retrieval query path"
                  value={String(
                    (selected.data.config as Record<string, unknown>).query_path ?? 'input',
                  )}
                  onChange={(event) => updateConfig('query_path', event.target.value)}
                />
              </label>
              <label>
                Top K
                <input
                  aria-label="Retrieval top K"
                  type="number"
                  min="1"
                  max="20"
                  value={Number((selected.data.config as Record<string, unknown>).top_k ?? 5)}
                  onChange={(event) => updateConfig('top_k', Number(event.target.value))}
                />
              </label>
              <p className="security-warning">
                Retrieved text is untrusted data and is isolated in controlled source context.
              </p>
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
                  setEdges(version.graph.edges.map(toCanvasEdge));
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
                  setEdges(initialGraph.edges.map(toCanvasEdge));
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
            {Array.isArray(currentRun.output?.retrieval_results) && (
              <div className="retrieval-results">
                <h3>Ranked sources</h3>
                {(currentRun.output.retrieval_results as Array<Record<string, unknown>>).map(
                  (result) => (
                    <article key={String(result.chunk_id)}>
                      <strong>
                        Source {String(result.rank)} /{' '}
                        {String((result.source as Record<string, unknown>)?.filename ?? 'document')}
                      </strong>
                      <small>
                        Page {String(result.page_number ?? 'N/A')} / cosine similarity{' '}
                        {Number(result.score ?? 0).toFixed(3)} / chunk {String(result.chunk_id)}
                      </small>
                      <p>{String(result.content ?? '').slice(0, 280)}</p>
                    </article>
                  ),
                )}
              </div>
            )}
            {Array.isArray(currentRun.output?.citations) &&
              currentRun.output.citations.length > 0 && (
                <p className="validation-message">
                  <strong>Validated citations</strong>
                  <br />
                  {currentRun.output.citations.map(String).join(', ')}
                </p>
              )}
            {currentRun.status === 'WAITING_FOR_APPROVAL' && (
              <p className="validation-message">
                <strong>WAITING FOR APPROVAL</strong>
                <br />
                Open the Approvals inbox to approve or reject this run.
              </p>
            )}
            {currentRun.errorMessage && <p className="error">{currentRun.errorMessage}</p>}
            {currentRun.nodeRuns && (
              <ol className="node-run-list">
                {currentRun.nodeRuns.map((nodeRun) => (
                  <li key={nodeRun.id} className={`node-run-${nodeRun.status.toLowerCase()}`}>
                    <strong>{nodeRun.nodeType}</strong> {nodeRun.status}
                    {nodeRun.status === 'SKIPPED' && <small> — branch not selected</small>}
                  </li>
                ))}
              </ol>
            )}
          </article>
          <article>
            <h2>Trace timeline</h2>
            <ol className="timeline">
              {trace.data?.map((event) => (
                <li key={event.id}>
                  <strong>{event.eventType}</strong>
                  <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
                  {traceSummary(event) ? <p>{traceSummary(event)}</p> : null}
                </li>
              ))}
            </ol>
          </article>
        </section>
      )}
    </main>
  );
}
