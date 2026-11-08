import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowGraph } from '@agentops/contracts';
import { RunExecutor } from '../src/executor.js';
import { validateWorkflowGraph } from '../src/graph.js';
import { MemoryStore } from './memory-store.js';

const graph: WorkflowGraph = {
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
      id: 'approval',
      type: 'HUMAN_APPROVAL',
      version: 1,
      position: { x: 3, y: 0 },
      config: {
        title: 'Approve answer',
        instructions: 'Review before release.',
        allow_reject: true,
      },
    },
    { id: 'output', type: 'OUTPUT', version: 1, position: { x: 4, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'prompt' },
    { id: 'e2', source: 'prompt', target: 'llm' },
    { id: 'e3', source: 'llm', target: 'approval' },
    { id: 'e4', source: 'approval', target: 'output' },
  ],
};
const logger = { info() {}, error() {} };

const fixture = async () => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: 'P', description: null });
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
    runtimeInput: { input: 'queues' },
  });
  return { store, project, workflow, version, run };
};

describe('Milestone 3 durable execution', () => {
  it('validates a linear HUMAN_APPROVAL workflow', () => {
    const result = validateWorkflowGraph(graph);
    assert.equal(result.valid, true);
    assert.deepEqual(result.executionOrder, ['input', 'prompt', 'llm', 'approval', 'output']);
  });

  it('pauses without blocking, persists approval, and resumes without invoking the model twice', async () => {
    const { store, project, version, run } = await fixture();
    let modelCalls = 0;
    const executor = new RunExecutor(
      store,
      {
        async ready() {
          return { status: 'ok', service: 'ai', version: '1' };
        },
        async generate(request) {
          modelCalls += 1;
          return {
            text: `answer:${request.prompt}`,
            provider: 'development',
            model: request.model,
            latency_ms: 1,
            input_tokens: 2,
            output_tokens: 3,
          };
        },
      },
      logger,
    );
    assert.equal(await executor.execute(run, version), 'WAITING_FOR_APPROVAL');
    assert.equal((await store.getRunById(run.id))?.status, 'WAITING_FOR_APPROVAL');
    assert.equal(store.approvals.length, 1);
    assert.equal(modelCalls, 1);
    const approval = store.approvals[0];
    assert.ok(approval);
    await store.decideApproval(project.id, approval.id, 'APPROVED', 'looks good');
    assert.equal(await executor.execute((await store.getRunById(run.id))!, version), 'COMPLETED');
    assert.equal(modelCalls, 1);
    assert.equal(store.nodeRuns.length, 5);
    assert.equal((await store.getRunById(run.id))?.output?.text, 'answer:Explain queues');
    assert.ok(store.traces.some((event) => event.eventType === 'APPROVAL_REQUESTED'));
    assert.ok(store.traces.some((event) => event.eventType === 'RUN_RESUMED'));
  });

  it('rejects approval as a cancellation and keeps project scoping explicit', async () => {
    const { store, project, version, run } = await fixture();
    const executor = new RunExecutor(
      store,
      {
        async ready() {
          return { status: 'ok', service: 'ai', version: '1' };
        },
        async generate(request) {
          return {
            text: request.prompt,
            provider: 'development',
            model: request.model,
            latency_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
          };
        },
      },
      logger,
    );
    await executor.execute(run, version);
    const approval = store.approvals[0];
    assert.ok(approval);
    const other = await store.createProject({ name: 'Other', description: null });
    assert.equal(await store.getApproval(other.id, approval.id), null);
    await store.decideApproval(project.id, approval.id, 'REJECTED', 'not safe');
    assert.equal(await executor.execute((await store.getRunById(run.id))!, version), 'CANCELLED');
    assert.equal((await store.getRunById(run.id))?.status, 'CANCELLED');
  });
});
