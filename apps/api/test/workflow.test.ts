import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { WorkflowGraph } from '@agentops/contracts';
import { buildApp, type Dependencies } from '../src/app.js';
import { MemoryStore } from './memory-store.js';

const graph: WorkflowGraph = {
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'prompt',
      type: 'PROMPT',
      version: 1,
      position: { x: 1, y: 0 },
      config: { template: 'Explain: {{input}}' },
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
};

const dependencies = (store: MemoryStore, fail = false): Dependencies => ({
  store,
  async checkPostgres() {},
  async checkRedis() {},
  aiClient: {
    async ready() {
      return { status: 'ok', service: 'ai-service', version: '0.1.0' };
    },
    async generate(request) {
      if (fail) throw new Error('Provider request failed');
      return {
        text: `DEV_RESPONSE: ${request.prompt}`,
        provider: 'development',
        model: request.model,
        latency_ms: 0,
        input_tokens: null,
        output_tokens: null,
      };
    },
  },
  async close() {},
});

const waitForTerminal = async (store: MemoryStore, runId: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = store.runs.find((item) => item.id === runId);
    if (run?.status === 'COMPLETED' || run?.status === 'FAILED') return run;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Run did not complete');
};

describe('Milestone 1 API vertical slice', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('creates projects/workflows, immutable versions, and a successful traced run', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store));
    apps.push(app);
    const project = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Demo' } })
    ).json<{ id: string }>();
    const workflowResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/workflows`,
      payload: { name: 'Explain', graph },
    });
    assert.equal(workflowResponse.statusCode, 201);
    const workflow = workflowResponse.json<{ id: string }>();
    const versionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/workflows/${workflow.id}/versions`,
      payload: { graph },
    });
    assert.equal(versionResponse.statusCode, 201);
    const version = versionResponse.json<{ id: string; graph: WorkflowGraph }>();
    graph.nodes[1] = { ...graph.nodes[1]!, position: { x: 99, y: 99 } };
    assert.notEqual(version.graph.nodes[1]?.position.x, 99);
    const runResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/workflows/${workflow.id}/runs`,
      payload: { workflowVersionId: version.id, input: { input: 'Docker' } },
    });
    assert.equal(runResponse.statusCode, 202);
    const created = runResponse.json<{ id: string }>();
    const completed = await waitForTerminal(store, created.id);
    assert.equal(completed.status, 'COMPLETED');
    assert.deepEqual(completed.output, { text: 'DEV_RESPONSE: Explain: Docker' });
    assert.deepEqual(
      store.nodeRuns.map((node) => node.nodeType),
      ['INPUT', 'PROMPT', 'LLM', 'OUTPUT'],
    );
    assert.ok(store.traces.some((event) => event.eventType === 'MODEL_REQUEST_COMPLETED'));
    assert.ok(store.traces.some((event) => event.eventType === 'RUN_COMPLETED'));
  });

  it('rejects invalid versions and cross-project workflow access', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store));
    apps.push(app);
    const first = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'A' } })
    ).json<{ id: string }>();
    const second = (
      await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'B' } })
    ).json<{ id: string }>();
    const workflow = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${first.id}/workflows`,
        payload: { name: 'Private', graph },
      })
    ).json<{ id: string }>();
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${second.id}/workflows/${workflow.id}`,
        })
      ).statusCode,
      404,
    );
    const missingVersionRun = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${first.id}/workflows/${workflow.id}/runs`,
      payload: { input: { input: 'Docker' } },
    });
    assert.equal(missingVersionRun.statusCode, 422);
    assert.match(missingVersionRun.body, /WORKFLOW_VERSION_REQUIRED/);
    const cyclic = structuredClone(graph);
    cyclic.edges.push({ id: 'cycle', source: 'output', target: 'input' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${first.id}/workflows/${workflow.id}/versions`,
      payload: { graph: cyclic },
    });
    assert.equal(response.statusCode, 422);
    assert.match(response.body, /cycle/i);
  });

  it('persists safe failed node/run statuses and failure trace events', async () => {
    const store = new MemoryStore();
    const app = await buildApp(undefined, dependencies(store, true));
    apps.push(app);
    const project = await store.createProject({ name: 'Demo', description: null });
    const workflow = await store.createWorkflow(project.id, {
      name: 'Explain',
      description: null,
      draftGraph: graph,
    });
    assert.ok(workflow);
    const version = await store.createVersion(project.id, workflow.id, graph);
    assert.ok(version);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/workflows/${workflow.id}/runs`,
      payload: { workflowVersionId: version.id, input: { input: 'Docker' } },
    });
    const failed = await waitForTerminal(store, response.json<{ id: string }>().id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(store.nodeRuns.find((node) => node.nodeType === 'LLM')?.status, 'FAILED');
    assert.ok(store.traces.some((event) => event.eventType === 'NODE_FAILED'));
    assert.ok(store.traces.some((event) => event.eventType === 'RUN_FAILED'));
  });
});
