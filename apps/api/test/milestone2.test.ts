import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { WorkflowGraph } from '@agentops/contracts';
import { buildApp, type Dependencies } from '../src/app.js';
import { evaluateOutput } from '../src/evaluators.js';
import { MemoryStore } from './memory-store.js';

const dependencies = (store: MemoryStore): Dependencies => ({
  store,
  async checkPostgres() {},
  async checkRedis() {},
  async close() {},
  aiClient: {
    async ready() {
      return { status: 'ok', service: 'ai-service', version: '0.1.0' };
    },
    async generate(request) {
      return {
        text: `DEV_RESPONSE: ${request.prompt}`,
        provider: 'development',
        model: request.model,
        latency_ms: 2,
        input_tokens: 3,
        output_tokens: request.prompt.includes('example') ? 9 : 5,
      };
    },
  },
});
const graphForPrompt = (promptVersionId: string): WorkflowGraph => ({
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'prompt',
      type: 'PROMPT',
      version: 1,
      position: { x: 1, y: 0 },
      config: { prompt_version_id: promptVersionId },
    },
    {
      id: 'llm',
      type: 'LLM',
      version: 1,
      position: { x: 2, y: 0 },
      config: { provider: 'configured-default', model: 'configured-default', temperature: 0 },
    },
    { id: 'output', type: 'OUTPUT', version: 1, position: { x: 3, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'prompt' },
    { id: 'e2', source: 'prompt', target: 'llm' },
    { id: 'e3', source: 'llm', target: 'output' },
  ],
});
const waitForEvaluation = async (store: MemoryStore, id: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = store.evaluationRuns.find((item) => item.id === id);
    if (run?.status === 'COMPLETED' || run?.status === 'FAILED') return run;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Evaluation did not finish');
};

describe('deterministic evaluators', () => {
  it('supports exact, contains, not-contains, regex, and JSON schema rules', () => {
    assert.equal(
      evaluateOutput({ type: 'EXACT_MATCH' }, { text: 'yes' }, { text: 'yes' }).passed,
      true,
    );
    assert.equal(
      evaluateOutput({ type: 'CONTAINS', values: ['container'] }, {}, { text: 'a container' })
        .score,
      1,
    );
    assert.equal(
      evaluateOutput({ type: 'NOT_CONTAINS', values: ['unsafe'] }, {}, { text: 'safe' }).passed,
      true,
    );
    assert.equal(
      evaluateOutput({ type: 'REGEX', pattern: 'docker', flags: 'i' }, {}, { text: 'Docker' })
        .passed,
      true,
    );
    assert.equal(
      evaluateOutput(
        {
          type: 'JSON_SCHEMA',
          schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        },
        {},
        { text: 'ok' },
      ).passed,
      true,
    );
  });
});

describe('Milestone 2 prompt and evaluation API', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('creates immutable prompt versions and rejects unsafe or cross-project references', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store));
    apps.push(app);
    const a = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'A' } })
    ).json<{ id: string }>();
    const b = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'B' } })
    ).json<{ id: string }>();
    const prompt = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${a.id}/prompts`,
        payload: { name: 'Beginner Explanation' },
      })
    ).json<{ id: string }>();
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${a.id}/prompts/${prompt.id}/versions`,
      payload: { template: 'Run {{input.toString()}}' },
    });
    assert.equal(invalid.statusCode, 422);
    const v1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${a.id}/prompts/${prompt.id}/versions`,
        payload: { template: 'Explain simply: {{input}}', changeNotes: 'Initial' },
      })
    ).json<{ id: string; versionNumber: number; template: string }>();
    const v2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${a.id}/prompts/${prompt.id}/versions`,
        payload: {
          template: 'Explain to a beginner using simple language and one example: {{input}}',
        },
      })
    ).json<{ id: string; versionNumber: number }>();
    assert.equal(v1.versionNumber, 1);
    assert.equal(v2.versionNumber, 2);
    assert.equal(v1.template, 'Explain simply: {{input}}');
    assert.equal(
      (await app.inject({ method: 'GET', url: `/api/v1/projects/${b.id}/prompts/${prompt.id}` }))
        .statusCode,
      404,
    );
    const workflow = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${b.id}/workflows`,
        payload: { name: 'Cross project', graph: graphForPrompt(v1.id) },
      })
    ).json<{ id: string }>();
    const version = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${b.id}/workflows/${workflow.id}/versions`,
      payload: { graph: graphForPrompt(v1.id) },
    });
    assert.equal(version.statusCode, 422);
    assert.match(version.body, /unavailable/);
  });

  it('runs multiple cases through normal WorkflowRuns, persists metrics, and compares prompt versions', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store));
    apps.push(app);
    const project = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Demo' } })
    ).json<{ id: string }>();
    const prompt = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/prompts`,
        payload: { name: 'Beginner Explanation' },
      })
    ).json<{ id: string }>();
    const pv1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/prompts/${prompt.id}/versions`,
        payload: { template: 'Explain simply: {{input}}' },
      })
    ).json<{ id: string }>();
    const pv2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/prompts/${prompt.id}/versions`,
        payload: { template: 'Explain to a beginner with one example: {{input}}' },
      })
    ).json<{ id: string }>();
    const workflow = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/workflows`,
        payload: { name: 'Explain', graph: graphForPrompt(pv1.id) },
      })
    ).json<{ id: string }>();
    const wv1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/workflows/${workflow.id}/versions`,
        payload: { graph: graphForPrompt(pv1.id) },
      })
    ).json<{ id: string; graph: WorkflowGraph }>();
    const wv2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/workflows/${workflow.id}/versions`,
        payload: { graph: graphForPrompt(pv2.id) },
      })
    ).json<{ id: string; graph: WorkflowGraph }>();
    assert.equal(
      (wv1.graph.nodes[1]?.config as { prompt_version_id: string }).prompt_version_id,
      pv1.id,
    );
    const dataset = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/evaluation-datasets`,
        payload: { name: 'Beginner Explanation Tests' },
      })
    ).json<{ id: string }>();
    for (const payload of [
      {
        input: { input: 'What is Docker?' },
        expectedOutput: {},
        evaluatorConfig: { type: 'CONTAINS', values: ['Docker'] },
      },
      {
        input: { input: 'What is Kubernetes?' },
        expectedOutput: {},
        evaluatorConfig: { type: 'CONTAINS', values: ['example'] },
      },
    ])
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/evaluation-datasets/${dataset.id}/cases`,
            payload,
          })
        ).statusCode,
        201,
      );
    const launch = async (workflowVersionId: string) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/evaluation-runs`,
        payload: { datasetId: dataset.id, workflowId: workflow.id, workflowVersionId },
      });
      assert.equal(response.statusCode, 202);
      const created = response.json<{ id: string }>();
      return waitForEvaluation(store, created.id);
    };
    const runA = await launch(wv1.id);
    const runB = await launch(wv2.id);
    assert.equal(runA.status, 'COMPLETED');
    assert.equal(runA.totalCases, 2);
    assert.equal(runA.passedCases, 1);
    assert.equal(runA.averageScore, 0.5);
    assert.equal(runB.passedCases, 2);
    assert.equal(runB.averageScore, 1);
    assert.ok(runB.totalTokens > runA.totalTokens);
    const results = store.evaluationCaseResults.filter((item) => item.evaluationRunId === runA.id);
    assert.equal(results.length, 2);
    assert.ok(results.every((item) => item.workflowRunId));
    assert.equal(store.runs.filter((run) => run.workflowVersionId === wv1.id).length, 2);
    assert.ok(store.traces.some((event) => event.eventType === 'RUN_COMPLETED'));
    const comparison = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/evaluation-comparisons`,
      payload: { evaluationRunIdA: runA.id, evaluationRunIdB: runB.id },
    });
    assert.equal(comparison.statusCode, 200);
    const data = comparison.json<{
      deltas: { qualityScore: number; passPercentagePoints: number; totalTokens: number };
      runA: { promptVersionIds: string[] };
      runB: { promptVersionIds: string[] };
    }>();
    assert.equal(data.deltas.qualityScore, 0.5);
    assert.equal(data.deltas.passPercentagePoints, 50);
    assert.ok(data.deltas.totalTokens > 0);
    assert.deepEqual(data.runA.promptVersionIds, [pv1.id]);
    assert.deepEqual(data.runB.promptVersionIds, [pv2.id]);
  });

  it('persists failed evaluation cases and rejects incompatible comparisons', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store));
    apps.push(app);
    const project = await store.createProject({ name: 'Demo', description: null });
    const prompt = await store.createPrompt(project.id, { name: 'P', description: null });
    assert.ok(prompt);
    const pv = await store.createPromptVersion(project.id, prompt.id, {
      template: 'Explain: {{input}}',
      variables: ['input'],
      changeNotes: null,
    });
    assert.ok(pv);
    const workflow = await store.createWorkflow(project.id, {
      name: 'W',
      description: null,
      draftGraph: graphForPrompt(pv.id),
    });
    assert.ok(workflow);
    const version = await store.createVersion(project.id, workflow.id, graphForPrompt(pv.id));
    assert.ok(version);
    const dataset = await store.createEvaluationDataset(project.id, {
      name: 'Bad',
      description: null,
    });
    assert.ok(dataset);
    await store.createEvaluationCase(project.id, dataset.id, {
      input: { wrong: 'value' },
      expectedOutput: {},
      evaluatorConfig: { type: 'EXACT_MATCH' },
      metadata: {},
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/evaluation-runs`,
      payload: { datasetId: dataset.id, workflowId: workflow.id, workflowVersionId: version.id },
    });
    const run = await waitForEvaluation(store, response.json<{ id: string }>().id);
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.failedCases, 1);
    assert.equal(store.evaluationCaseResults[0]?.status, 'FAILED');
    assert.ok(store.evaluationCaseResults[0]?.workflowRunId);
    const other = await store.createEvaluationDataset(project.id, {
      name: 'Other',
      description: null,
    });
    assert.ok(other);
    const fake = await store.createEvaluationRun({
      projectId: project.id,
      datasetId: other.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      totalCases: 0,
    });
    await store.updateEvaluationRun(fake.id, { status: 'COMPLETED' });
    const comparison = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/evaluation-comparisons`,
      payload: { evaluationRunIdA: run.id, evaluationRunIdB: fake.id },
    });
    assert.equal(comparison.statusCode, 422);
    assert.match(comparison.body, /INCOMPATIBLE/);
  });
});
