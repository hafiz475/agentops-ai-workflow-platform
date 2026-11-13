import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, workflowTraceUrl, type EvaluationRun, type EvaluatorConfig } from './api';

export const evaluationPollingInterval = (
  status: EvaluationRun['status'] | undefined,
): number | false => (status === 'QUEUED' || status === 'RUNNING' ? 800 : false);
export const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Value must be a JSON object.');
  return parsed as Record<string, unknown>;
};
const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);
export interface EvaluationsPageProps {
  projectId: string;
}
export function EvaluationsPage({ projectId }: EvaluationsPageProps) {
  const client = useQueryClient();
  const [datasetName, setDatasetName] = useState('Beginner Explanation Tests');
  const [datasetId, setDatasetId] = useState('');
  const [caseInput, setCaseInput] = useState('{"input":"What is Docker?"}');
  const [expected, setExpected] = useState('{}');
  const [evaluatorType, setEvaluatorType] = useState<EvaluatorConfig['type']>('CONTAINS');
  const [evaluatorValue, setEvaluatorValue] = useState('container');
  const [workflowId, setWorkflowId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [message, setMessage] = useState(
    'Create a synthetic dataset and evaluate an immutable WorkflowVersion.',
  );
  const datasets = useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => api.listDatasets(projectId),
  });
  const workflows = useQuery({
    queryKey: ['workflows', projectId],
    queryFn: () => api.listWorkflows(projectId),
  });
  const versions = useQuery({
    queryKey: ['versions', projectId, workflowId],
    queryFn: () => api.listVersions(projectId, workflowId),
    enabled: Boolean(workflowId),
  });
  const runs = useQuery({
    queryKey: ['evaluation-runs', projectId],
    queryFn: () => api.listEvaluationRuns(projectId),
    refetchInterval: (query) =>
      (query.state.data as EvaluationRun[] | undefined)?.some((run) =>
        evaluationPollingInterval(run.status),
      )
        ? 800
        : false,
  });
  const selectedRun = useQuery({
    queryKey: ['evaluation-run', projectId, selectedRunId],
    queryFn: () => api.getEvaluationRun(projectId, selectedRunId),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) =>
      evaluationPollingInterval((query.state.data as EvaluationRun | undefined)?.status),
  });
  useEffect(() => {
    if (!datasetId && datasets.data?.[0]) setDatasetId(datasets.data[0].id);
  }, [datasetId, datasets.data]);
  useEffect(() => {
    if (!workflowId && workflows.data?.[0]) setWorkflowId(workflows.data[0].id);
  }, [workflowId, workflows.data]);
  useEffect(() => {
    if (versions.data?.[0] && !versions.data.some((item) => item.id === versionId))
      setVersionId(versions.data[0].id);
  }, [versionId, versions.data]);
  const completedRuns = runs.data?.filter((run) => run.status === 'COMPLETED') ?? [];
  const createDataset = useMutation({
    mutationFn: () => api.createDataset(projectId, datasetName),
    onSuccess: async (created) => {
      setDatasetId(created.id);
      setMessage('Dataset created. Add deterministic evaluation cases.');
      await client.invalidateQueries({ queryKey: ['datasets', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const addCase = useMutation({
    mutationFn: () => {
      let config: EvaluatorConfig;
      if (evaluatorType === 'EXACT_MATCH') config = { type: 'EXACT_MATCH' };
      else if (evaluatorType === 'CONTAINS' || evaluatorType === 'NOT_CONTAINS')
        config = {
          type: evaluatorType,
          values: evaluatorValue
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        };
      else if (evaluatorType === 'REGEX')
        config = { type: 'REGEX', pattern: evaluatorValue, flags: 'i' };
      else if (evaluatorType === 'JSON_SCHEMA')
        config = { type: 'JSON_SCHEMA', schema: parseJsonObject(evaluatorValue) };
      else if (evaluatorType === 'RETRIEVAL_HIT_AT_K')
        config = { type: 'RETRIEVAL_HIT_AT_K', k: Number(evaluatorValue) };
      else if (evaluatorType === 'RETRIEVAL_RECALL_AT_K')
        config = { type: 'RETRIEVAL_RECALL_AT_K', k: Number(evaluatorValue) };
      else if (evaluatorType === 'RETRIEVAL_MRR') config = { type: 'RETRIEVAL_MRR' };
      else if (evaluatorType === 'AGENT_SUCCESS' || evaluatorType === 'MAX_STEPS_EXCEEDED')
        config = { type: evaluatorType };
      else if (
        evaluatorType === 'EXPECTED_TOOL_USED' ||
        evaluatorType === 'FORBIDDEN_TOOL_NOT_USED'
      )
        config = {
          type: evaluatorType,
          tool_name: evaluatorValue as 'retrieval' | 'http_request' | 'transform',
        };
      else {
        const citation = parseJsonObject(evaluatorValue);
        config = {
          type: 'CITATION_MATCH',
          required_chunk_ids: Array.isArray(citation.required_chunk_ids)
            ? citation.required_chunk_ids.map(String)
            : [],
          forbidden_chunk_ids: Array.isArray(citation.forbidden_chunk_ids)
            ? citation.forbidden_chunk_ids.map(String)
            : [],
        };
      }
      return api.addEvaluationCase(
        projectId,
        datasetId,
        parseJsonObject(caseInput),
        parseJsonObject(expected),
        config,
      );
    },
    onSuccess: async () => {
      setMessage('Evaluation case added.');
      await client.invalidateQueries({ queryKey: ['datasets', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const launch = useMutation({
    mutationFn: () => api.createEvaluationRun(projectId, datasetId, workflowId, versionId),
    onSuccess: async (created) => {
      setSelectedRunId(created.id);
      setMessage(`Evaluation ${created.id} queued.`);
      await client.invalidateQueries({ queryKey: ['evaluation-runs', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const comparison = useMutation({
    mutationFn: () => api.compareEvaluationRuns(projectId, compareA, compareB),
    onError: (error) => setMessage(error.message),
  });
  const run = selectedRun.data;
  return (
    <section className="workspace-page" aria-label="Evaluations page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">AI EVALUATIONS</span>
          <h2>Measure quality, latency, and tokens</h2>
        </div>
        <span className="provider-badge">Deterministic evaluators</span>
      </div>
      <div className="evaluation-columns">
        <article className="panel">
          <h3>1. Evaluation dataset</h3>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              createDataset.mutate();
            }}
          >
            <input
              aria-label="Dataset name"
              value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)}
            />
            <button>Create dataset</button>
          </form>
          <select
            aria-label="Evaluation dataset"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            {datasets.data?.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset.cases.length})
              </option>
            ))}
          </select>
          <div className="stack case-editor">
            <h4>Add synthetic case</h4>
            <label>
              Input JSON
              <textarea
                aria-label="Case input"
                value={caseInput}
                onChange={(event) => setCaseInput(event.target.value)}
              />
            </label>
            <label>
              Expected output JSON
              <textarea
                aria-label="Expected output"
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
              />
            </label>
            <label>
              Evaluator
              <select
                aria-label="Evaluator type"
                value={evaluatorType}
                onChange={(event) =>
                  setEvaluatorType(event.target.value as EvaluatorConfig['type'])
                }
              >
                {[
                  'EXACT_MATCH',
                  'CONTAINS',
                  'NOT_CONTAINS',
                  'REGEX',
                  'JSON_SCHEMA',
                  'RETRIEVAL_HIT_AT_K',
                  'RETRIEVAL_RECALL_AT_K',
                  'RETRIEVAL_MRR',
                  'CITATION_MATCH',
                  'AGENT_SUCCESS',
                  'MAX_STEPS_EXCEEDED',
                  'EXPECTED_TOOL_USED',
                  'FORBIDDEN_TOOL_NOT_USED',
                ].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            {!['EXACT_MATCH', 'RETRIEVAL_MRR', 'AGENT_SUCCESS', 'MAX_STEPS_EXCEEDED'].includes(
              evaluatorType,
            ) && (
              <label>
                Evaluator configuration
                <textarea
                  aria-label="Evaluator configuration"
                  value={evaluatorValue}
                  onChange={(event) => setEvaluatorValue(event.target.value)}
                />
              </label>
            )}
            <button disabled={!datasetId} onClick={() => addCase.mutate()}>
              Add case
            </button>
          </div>
        </article>
        <article className="panel">
          <h3>2. Run evaluation</h3>
          <div className="stack">
            <label>
              Workflow
              <select
                aria-label="Evaluation workflow"
                value={workflowId}
                onChange={(event) => setWorkflowId(event.target.value)}
              >
                {workflows.data?.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Immutable version
              <select
                aria-label="Evaluation workflow version"
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
              >
                {versions.data?.map((version) => (
                  <option key={version.id} value={version.id}>
                    Version {version.versionNumber}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!datasetId || !versionId} onClick={() => launch.mutate()}>
              Run Evaluation
            </button>
          </div>
          <h4>Evaluation runs</h4>
          <div className="run-list">
            {runs.data?.map((item) => (
              <button
                className="registry-item"
                key={item.id}
                onClick={() => setSelectedRunId(item.id)}
              >
                <strong>{item.status}</strong>
                <small>
                  {item.passedCases}/{item.totalCases} passed · {item.id.slice(0, 8)}
                </small>
              </button>
            ))}
          </div>
        </article>
      </div>
      <p className="validation-message" role="status">
        {message}
      </p>
      {run && (
        <section className="evaluation-results">
          <div className="section-heading">
            <div>
              <span className={`run-status status-${run.status.toLowerCase()}`}>{run.status}</span>
              <h2>Evaluation result</h2>
            </div>
            <code>{run.id}</code>
          </div>
          {run.errorMessage && <p className="error">{run.errorMessage}</p>}
          <div className="metric-grid">
            {[
              ['Total Cases', run.totalCases],
              ['Passed', run.passedCases],
              ['Failed', run.failedCases],
              ['Pass %', `${number(run.passPercentage)}%`],
              ['Average Score', number(run.averageScore, 2)],
              ['Average Latency', `${number(run.averageLatencyMs)} ms`],
              ['Total Tokens', run.totalTokens],
            ].map(([label, value]) => (
              <article className="metric-card" key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Evaluator</th>
                  <th>Score</th>
                  <th>Result</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {run.results?.map((result) => (
                  <tr key={result.id}>
                    <td>
                      <code>{JSON.stringify(result.evaluationCase?.input)}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(result.evaluationCase?.expectedOutput)}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(result.actualOutput)}</code>
                    </td>
                    <td>{result.evaluationCase?.evaluatorConfig.type}</td>
                    <td>{number(result.score, 2)}</td>
                    <td className={result.passed ? 'pass' : 'fail'}>
                      {result.passed ? 'PASS' : 'FAIL'}
                    </td>
                    <td>{result.latencyMs ?? 0} ms</td>
                    <td>{(result.inputTokens ?? 0) + (result.outputTokens ?? 0)}</td>
                    <td>
                      {result.workflowRunId ? (
                        <a
                          href={workflowTraceUrl(projectId, run.workflowId, result.workflowRunId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Trace
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="comparison-panel">
        <span className="eyebrow">VERSION COMPARISON</span>
        <h2>Compare two completed runs</h2>
        <div className="comparison-controls">
          <select
            aria-label="Comparison run A"
            value={compareA}
            onChange={(event) => setCompareA(event.target.value)}
          >
            <option value="">Run A</option>
            {completedRuns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)} · {number(item.averageScore, 2)}
              </option>
            ))}
          </select>
          <select
            aria-label="Comparison run B"
            value={compareB}
            onChange={(event) => setCompareB(event.target.value)}
          >
            <option value="">Run B</option>
            {completedRuns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)} · {number(item.averageScore, 2)}
              </option>
            ))}
          </select>
          <button disabled={!compareA || !compareB} onClick={() => comparison.mutate()}>
            Compare versions
          </button>
        </div>
        {comparison.data && (
          <div className="comparison-grid">
            <article>
              <h3>Run A</h3>
              <p>
                WorkflowVersion <code>{comparison.data.runA.workflowVersionId}</code>
              </p>
              <p>
                PromptVersion{' '}
                {comparison.data.runA.promptVersionIds.join(', ') || 'inline legacy prompt'}
              </p>
              <strong>
                {number(comparison.data.runA.passPercentage)}% pass ·{' '}
                {number(comparison.data.runA.averageScore, 2)} score
              </strong>
            </article>
            <article>
              <h3>Run B</h3>
              <p>
                WorkflowVersion <code>{comparison.data.runB.workflowVersionId}</code>
              </p>
              <p>
                PromptVersion{' '}
                {comparison.data.runB.promptVersionIds.join(', ') || 'inline legacy prompt'}
              </p>
              <strong>
                {number(comparison.data.runB.passPercentage)}% pass ·{' '}
                {number(comparison.data.runB.averageScore, 2)} score
              </strong>
            </article>
            <article className="delta-card">
              <h3>Measured B − A deltas</h3>
              <p>
                Quality {comparison.data.deltas.qualityScore >= 0 ? '+' : ''}
                {number(comparison.data.deltas.qualityScore, 2)}
              </p>
              <p>
                Pass rate {comparison.data.deltas.passPercentagePoints >= 0 ? '+' : ''}
                {number(comparison.data.deltas.passPercentagePoints)} points
              </p>
              <p>
                Latency {comparison.data.deltas.latencyMs >= 0 ? '+' : ''}
                {number(comparison.data.deltas.latencyMs)} ms
              </p>
              <p>
                Tokens {comparison.data.deltas.totalTokens >= 0 ? '+' : ''}
                {comparison.data.deltas.totalTokens}
              </p>
              <small>{comparison.data.interpretation}</small>
            </article>
          </div>
        )}
      </section>
    </section>
  );
}
