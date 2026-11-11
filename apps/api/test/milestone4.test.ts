import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowGraph, WorkflowNode } from '@agentops/contracts';
import { RunExecutor } from '../src/executor.js';
import { executeHttpRequest, HttpToolBlockedError, isBlockedAddress } from '../src/http-tool.js';
import { evaluateCondition, renderStructuredValue } from '../src/tool-values.js';
import { validateWorkflowGraph } from '../src/graph.js';
import { MemoryStore } from './memory-store.js';

const branchingGraph = (): WorkflowGraph => ({
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'prompt',
      type: 'PROMPT',
      version: 1,
      position: { x: 1, y: 0 },
      config: { template: 'Explain {{input}}' },
    },
    {
      id: 'llm',
      type: 'LLM',
      version: 1,
      position: { x: 2, y: 0 },
      config: { provider: 'configured-default', model: 'development', temperature: 0 },
    },
    {
      id: 'condition',
      type: 'CONDITION',
      version: 1,
      position: { x: 3, y: 0 },
      config: { path: 'text', operator: 'CONTAINS', value: 'approved' },
    },
    {
      id: 'transform',
      type: 'TRANSFORM',
      version: 1,
      position: { x: 4, y: -1 },
      config: { output: { text: 'processed: {{text}}', status: 'processed' } },
    },
    { id: 'true-output', type: 'OUTPUT', version: 1, position: { x: 5, y: -1 }, config: {} },
    { id: 'false-output', type: 'OUTPUT', version: 1, position: { x: 4, y: 1 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'prompt' },
    { id: 'e2', source: 'prompt', target: 'llm' },
    { id: 'e3', source: 'llm', target: 'condition' },
    { id: 'et', source: 'condition', target: 'transform', branch: 'true' },
    { id: 'ef', source: 'condition', target: 'false-output', branch: 'false' },
    { id: 'e4', source: 'transform', target: 'true-output' },
  ],
});

const httpNode = (
  overrides: Partial<Extract<WorkflowNode, { type: 'HTTP_REQUEST' }>['config']> = {},
) =>
  ({
    id: 'http',
    type: 'HTTP_REQUEST',
    version: 1,
    position: { x: 0, y: 0 },
    config: {
      method: 'GET',
      url: 'https://public.example/resource',
      headers: {},
      timeout_ms: 1_000,
      max_response_bytes: 1_024,
      retry_non_idempotent: false,
      ...overrides,
    },
  }) as Extract<WorkflowNode, { type: 'HTTP_REQUEST' }>;

describe('Milestone 4 graph validation', () => {
  it('accepts a deterministic true/false branch', () => {
    const result = validateWorkflowGraph(branchingGraph());
    assert.equal(result.valid, true, result.errors.join(' '));
  });

  for (const [name, mutate, expected] of [
    [
      'missing TRUE',
      (g: WorkflowGraph) => (g.edges = g.edges.filter((e) => e.branch !== 'true')),
      /TRUE branch/i,
    ],
    [
      'missing FALSE',
      (g: WorkflowGraph) => (g.edges = g.edges.filter((e) => e.branch !== 'false')),
      /FALSE branch/i,
    ],
    [
      'duplicate TRUE',
      (g: WorkflowGraph) =>
        g.edges.push({ id: 'extra', source: 'condition', target: 'false-output', branch: 'true' }),
      /exactly one TRUE/i,
    ],
    [
      'duplicate FALSE',
      (g: WorkflowGraph) =>
        g.edges.push({
          id: 'extra-false',
          source: 'condition',
          target: 'transform',
          branch: 'false',
        }),
      /exactly one FALSE/i,
    ],
    [
      'branch metadata on a normal edge',
      (g: WorkflowGraph) => {
        const edge = g.edges.find((item) => item.id === 'e1');
        if (edge) edge.branch = 'true';
      },
      /Only CONDITION edges/i,
    ],
    [
      'unsupported merge',
      (g: WorkflowGraph) =>
        g.edges.push({ id: 'merge', source: 'transform', target: 'false-output' }),
      /exactly one incoming/i,
    ],
  ] as const) {
    it(`rejects ${name}`, () => {
      const graph = branchingGraph();
      mutate(graph);
      assert.match(validateWorkflowGraph(graph).errors.join(' '), expected);
    });
  }
});

describe('Milestone 4 deterministic tools', () => {
  it('evaluates declarative conditions without code execution', () => {
    const value = { text: 'approved result', score: 7, nested: { status: 'PASS' } };
    assert.equal(evaluateCondition(value, 'nested.status', 'EQUALS', 'PASS'), true);
    assert.equal(evaluateCondition(value, 'text', 'NOT_EQUALS', 'no'), true);
    assert.equal(evaluateCondition(value, 'text', 'CONTAINS', 'approved'), true);
    assert.equal(evaluateCondition(value, 'missing', 'NOT_EXISTS'), true);
    assert.equal(evaluateCondition(value, 'score', 'GREATER_THAN', 3), true);
    assert.equal(evaluateCondition(value, 'score', 'LESS_THAN', 3), false);
    assert.throws(() => evaluateCondition(value, 'text', 'GREATER_THAN', 3), /numeric/);
  });

  it('renders structured mappings, constants, nested paths, and rejects unknown variables', () => {
    assert.deepEqual(
      renderStructuredValue(
        { message: '{{result.text}}', label: 'ID={{input.customer_id}}', constant: true },
        { result: { text: 'done' }, input: { customer_id: 42 } },
      ),
      { message: 'done', label: 'ID=42', constant: true },
    );
    assert.throws(() => renderStructuredValue({ value: '{{missing}}' }, {}), /Unknown transform/);
  });
});

describe('Milestone 4 HTTP security', () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const context = {
    projectId: 'project-a',
    runId: 'run-a',
    nodeId: 'http',
    input: { text: 'hello' },
    secrets: { 'project-a': { token: 'top-secret' } },
    lookup: publicLookup,
  };

  it('blocks loopback, private, link-local, metadata, Docker, and private IPv6 destinations', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.1.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'fe80::1',
    ])
      assert.equal(isBlockedAddress(address), true, address);
    for (const url of [
      'http://localhost',
      'http://169.254.169.254/latest',
      'http://metadata.google.internal',
      'http://redis:6379',
    ])
      await assert.rejects(
        () => executeHttpRequest(httpNode({ url }), context),
        HttpToolBlockedError,
      );
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode(), {
          ...context,
          lookup: async () => [{ address: '10.1.2.3', family: 4 }],
        }),
      HttpToolBlockedError,
    );
  });

  it('handles JSON and text responses with safe persisted headers', async () => {
    const output = await executeHttpRequest(
      httpNode({ headers: { authorization: { secret_ref: 'token' } } }),
      {
        ...context,
        fetch: async (_url, init) => {
          assert.equal(new Headers(init?.headers).get('authorization'), 'top-secret');
          return new Response('{"ok":true}', {
            status: 200,
            headers: { 'content-type': 'application/json', 'set-cookie': 'private=1' },
          });
        },
      },
    );
    assert.deepEqual(output.body, { ok: true });
    assert.equal((output.headers as Record<string, string>)['set-cookie'], undefined);
    assert.doesNotMatch(JSON.stringify(output), /top-secret/);
    const text = await executeHttpRequest(httpNode(), {
      ...context,
      fetch: async () => new Response('plain', { status: 200 }),
    });
    assert.equal(text.body, 'plain');
  });

  it('blocks redirects to private addresses and caps response size', async () => {
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode(), {
          ...context,
          fetch: async () =>
            new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
        }),
      HttpToolBlockedError,
    );
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode({ max_response_bytes: 1_024 }), {
          ...context,
          fetch: async () => new Response('x'.repeat(1_025)),
        }),
      /exceeds/,
    );
  });

  it('enforces timeout, permanent HTTP failures, and project-scoped secret references', async () => {
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode({ timeout_ms: 100 }), {
          ...context,
          fetch: async (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
        }),
      /timed out/,
    );
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode(), {
          ...context,
          fetch: async () => new Response('bad request', { status: 400 }),
        }),
      /status 400/,
    );
    await assert.rejects(
      () =>
        executeHttpRequest(httpNode({ headers: { authorization: { secret_ref: 'token' } } }), {
          ...context,
          projectId: 'project-b',
        }),
      /unavailable in this project/,
    );
  });
});

describe('Milestone 4 branch execution', () => {
  it('executes only the selected branch and records the other branch as SKIPPED', async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: 'P', description: null });
    const graph = branchingGraph();
    const workflow = await store.createWorkflow(project.id, {
      name: 'W',
      description: null,
      draftGraph: graph,
    });
    assert.ok(workflow);
    const version = await store.createVersion(project.id, workflow.id, graph);
    assert.ok(version);
    const run = await store.createRun({
      projectId: project.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runtimeInput: { input: 'branching' },
    });
    const executor = new RunExecutor(
      store,
      {
        async ready() {
          return { status: 'ok', service: 'ai', version: '1' };
        },
        async generate() {
          return {
            text: 'approved answer',
            provider: 'development',
            model: 'development',
            latency_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
          };
        },
      },
      { info() {}, error() {} },
    );
    assert.equal(await executor.execute(run, version), 'COMPLETED');
    assert.equal((await store.getRunById(run.id))?.output?.text, 'processed: approved answer');
    assert.equal((await store.getNodeRun(run.id, 'false-output'))?.status, 'SKIPPED');
    assert.ok(store.traces.some((event) => event.eventType === 'BRANCH_SELECTED'));
    assert.ok(store.traces.some((event) => event.eventType === 'NODE_SKIPPED'));
  });

  it('executes the false branch without running the true transform path', async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: 'P', description: null });
    const graph = branchingGraph();
    const workflow = await store.createWorkflow(project.id, {
      name: 'W',
      description: null,
      draftGraph: graph,
    });
    assert.ok(workflow);
    const version = await store.createVersion(project.id, workflow.id, graph);
    assert.ok(version);
    const run = await store.createRun({
      projectId: project.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runtimeInput: { input: 'branching' },
    });
    const executor = new RunExecutor(
      store,
      {
        async ready() {
          return { status: 'ok', service: 'ai', version: '1' };
        },
        async generate() {
          return {
            text: 'rejected answer',
            provider: 'development',
            model: 'development',
            latency_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
          };
        },
      },
      { info() {}, error() {} },
    );
    assert.equal(await executor.execute(run, version), 'COMPLETED');
    assert.equal((await store.getRunById(run.id))?.output?.text, 'rejected answer');
    assert.equal((await store.getNodeRun(run.id, 'transform'))?.status, 'SKIPPED');
    assert.equal((await store.getNodeRun(run.id, 'true-output'))?.status, 'SKIPPED');
  });
});
