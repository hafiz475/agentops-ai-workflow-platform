import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentActionRequest, WorkflowGraph } from '@agentops/contracts';
import { RunExecutor } from '../src/executor.js';
import { evaluateOutput } from '../src/evaluators.js';
import { ToolRegistry } from '../src/tool-registry.js';
import { MemoryStore } from './memory-store.js';

const logger = { info() {}, error() {} };
const graph = (approval = false, maxSteps = 5): WorkflowGraph => ({
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'agent',
      type: 'AGENT',
      version: 1,
      position: { x: 1, y: 0 },
      config: {
        model: 'development-agent-v1',
        allowed_tools: ['transform'],
        max_steps: maxSteps,
        max_duration_ms: 60000,
        max_tool_calls: 5,
        max_total_tokens: 10000,
        require_approval_for: approval ? ['transform'] : [],
      },
    },
    { id: 'output', type: 'OUTPUT', version: 1, position: { x: 2, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'agent' },
    { id: 'e2', source: 'agent', target: 'output' },
  ],
});
const setup = async (g: WorkflowGraph) => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: 'P', description: null });
  const workflow = await store.createWorkflow(project.id, {
    name: 'A',
    description: null,
    draftGraph: g,
  });
  if (!workflow) throw new Error();
  const version = await store.createVersion(project.id, workflow.id, g);
  if (!version) throw new Error();
  const run = await store.createRun({
    projectId: project.id,
    workflowId: workflow.id,
    workflowVersionId: version.id,
    runtimeInput: { input: 'goal' },
  });
  return { store, project, version, run };
};
const client = (actions: (request: AgentActionRequest) => Record<string, unknown>) => ({
  async ready() {
    return { status: 'ok' as const, service: 'ai', version: '1' };
  },
  async generate() {
    throw new Error('unused');
  },
  async selectAgentAction(request: AgentActionRequest) {
    return {
      action: actions(request),
      provider: 'development',
      model: 'development-agent-v1',
      latency_ms: 0,
      input_tokens: null,
      output_tokens: null,
    } as never;
  },
});

describe('Milestone 6 controlled agents', () => {
  it('persists a tool step and final result through the existing executor', async () => {
    const s = await setup(graph());
    const executor = new RunExecutor(
      s.store,
      client((r) =>
        r.observations.length
          ? { type: 'FINAL', output: { text: 'done' }, action_summary: 'finish' }
          : {
              type: 'TOOL_CALL',
              tool_name: 'transform',
              arguments: { template: { text: 'transformed' }, input: {} },
              action_summary: 'transform',
            },
      ),
      logger,
    );
    assert.equal(await executor.execute(s.run, s.version), 'COMPLETED');
    assert.equal(s.store.agentExecutions[0]?.status, 'COMPLETED');
    assert.equal(s.store.agentSteps.length, 2);
    assert.equal(s.store.toolCalls[0]?.status, 'COMPLETED');
    assert.deepEqual((await s.store.getRunById(s.run.id))?.output?.text, 'done');
    assert.ok(s.store.traces.some((t) => t.eventType === 'AGENT_COMPLETED'));
  });
  it('pauses sensitive tools, resumes after approval, and does not repeat prior steps', async () => {
    const s = await setup(graph(true));
    const ai = client((r) =>
      r.observations.length
        ? { type: 'FINAL', output: { text: 'approved result' }, action_summary: 'finish' }
        : {
            type: 'TOOL_CALL',
            tool_name: 'transform',
            arguments: { template: { text: 'safe' }, input: {} },
            action_summary: 'sensitive transform',
          },
    );
    const executor = new RunExecutor(s.store, ai, logger);
    assert.equal(await executor.execute(s.run, s.version), 'WAITING_FOR_APPROVAL');
    assert.equal(s.store.toolCalls.length, 1);
    const approval = s.store.approvals[0];
    assert.equal(approval?.approvalType, 'AGENT_TOOL');
    if (!approval) throw new Error();
    await s.store.decideApproval(s.project.id, approval.id, 'APPROVED', null);
    assert.equal(
      await executor.execute((await s.store.getRunById(s.run.id))!, s.version),
      'COMPLETED',
    );
    assert.equal(s.store.toolCalls.length, 1);
    assert.equal(s.store.agentSteps.length, 2);
  });
  it('turns rejection into a bounded observation and permits a final alternative', async () => {
    const s = await setup(graph(true));
    const executor = new RunExecutor(
      s.store,
      client((r) =>
        r.observations.length
          ? {
              type: 'FINAL',
              output: { text: r.observations[0]?.status },
              action_summary: 'fallback',
            }
          : {
              type: 'TOOL_CALL',
              tool_name: 'transform',
              arguments: { template: { text: 'x' }, input: {} },
              action_summary: 'try',
            },
      ),
      logger,
    );
    await executor.execute(s.run, s.version);
    const approval = s.store.approvals[0];
    if (!approval) throw new Error();
    await s.store.decideApproval(s.project.id, approval.id, 'REJECTED', 'no');
    await executor.execute((await s.store.getRunById(s.run.id))!, s.version);
    assert.equal((await s.store.getRunById(s.run.id))?.output?.text, 'REJECTED_BY_HUMAN');
    assert.equal(s.store.toolCalls[0]?.status, 'REJECTED');
  });
  it('enforces max steps and reports deterministic agent evaluation metrics', async () => {
    const s = await setup(graph(false, 1));
    const executor = new RunExecutor(
      s.store,
      client(() => ({
        type: 'TOOL_CALL',
        tool_name: 'transform',
        arguments: { template: { text: 'x' }, input: {} },
        action_summary: 'loop',
      })),
      logger,
    );
    await executor.execute(s.run, s.version);
    const output = (await s.store.getRunById(s.run.id))?.output ?? {};
    assert.equal((output.agent as Record<string, unknown>).status, 'LIMIT_REACHED');
    assert.equal(evaluateOutput({ type: 'MAX_STEPS_EXCEEDED' }, {}, output).passed, true);
    assert.equal(
      evaluateOutput({ type: 'EXPECTED_TOOL_USED', tool_name: 'transform' }, {}, output).passed,
      true,
    );
    assert.equal(
      evaluateOutput({ type: 'FORBIDDEN_TOOL_NOT_USED', tool_name: 'http_request' }, {}, output)
        .passed,
      true,
    );
  });
  it('rejects unknown/disallowed tool actions and blocks private HTTP destinations', async () => {
    const s = await setup(graph());
    const executor = new RunExecutor(
      s.store,
      client(() => ({
        type: 'TOOL_CALL',
        tool_name: 'http_request',
        arguments: { url: 'http://127.0.0.1' },
        action_summary: 'bad',
      })),
      logger,
    );
    assert.equal(await executor.execute(s.run, s.version), 'FAILED');
    await assert.rejects(
      () =>
        new ToolRegistry().execute(
          'http_request',
          { method: 'GET', url: 'http://127.0.0.1' },
          {
            store: s.store,
            logger,
            projectId: s.project.id,
            runId: s.run.id,
            nodeRunId: 'node',
            nodeId: 'agent',
            secrets: {},
          },
        ),
      /private or internal/i,
    );
  });
  it('enforces max tool calls while still allowing a zero-tool final action', async () => {
    const noTools = graph();
    const agent = noTools.nodes.find((n) => n.type === 'AGENT');
    if (!agent || agent.type !== 'AGENT') throw new Error();
    agent.config.max_tool_calls = 0;
    const finalSetup = await setup(noTools);
    const finalExecutor = new RunExecutor(
      finalSetup.store,
      client(() => ({
        type: 'FINAL',
        output: { text: 'no tools needed' },
        action_summary: 'finish',
      })),
      logger,
    );
    await finalExecutor.execute(finalSetup.run, finalSetup.version);
    assert.equal(
      (await finalSetup.store.getRunById(finalSetup.run.id))?.output?.text,
      'no tools needed',
    );
    const limitedSetup = await setup(noTools);
    const limitedExecutor = new RunExecutor(
      limitedSetup.store,
      client(() => ({
        type: 'TOOL_CALL',
        tool_name: 'transform',
        arguments: { template: { text: 'x' }, input: {} },
        action_summary: 'tool',
      })),
      logger,
    );
    await limitedExecutor.execute(limitedSetup.run, limitedSetup.version);
    assert.equal(
      (
        (await limitedSetup.store.getRunById(limitedSetup.run.id))?.output?.agent as Record<
          string,
          unknown
        >
      ).limit_reason,
      'MAX_TOOL_CALLS',
    );
    assert.equal(limitedSetup.store.toolCalls.length, 0);
  });
  it('validates tool arguments before dispatch and never persists hidden reasoning', async () => {
    const s = await setup(graph());
    const executor = new RunExecutor(
      s.store,
      client(() => ({
        type: 'TOOL_CALL',
        tool_name: 'transform',
        arguments: { template: 'unsafe' },
        action_summary: 'concise action only',
      })),
      logger,
    );
    assert.equal(await executor.execute(s.run, s.version), 'FAILED');
    assert.equal(s.store.toolCalls.length, 0);
    assert.equal(s.store.agentSteps[0]?.actionSummary, 'concise action only');
    assert.equal('reasoning' in (s.store.agentSteps[0]?.input ?? {}), false);
  });
  it('does not repeat a completed agent execution on duplicate queue delivery', async () => {
    const s = await setup(graph());
    let calls = 0;
    const executor = new RunExecutor(
      s.store,
      client((r) => {
        calls += 1;
        return r.observations.length
          ? { type: 'FINAL', output: { text: 'done' }, action_summary: 'finish' }
          : {
              type: 'TOOL_CALL',
              tool_name: 'transform',
              arguments: { template: { text: 'x' }, input: {} },
              action_summary: 'tool',
            };
      }),
      logger,
    );
    await executor.execute(s.run, s.version);
    assert.equal(
      await executor.execute((await s.store.getRunById(s.run.id))!, s.version),
      'COMPLETED',
    );
    assert.equal(calls, 2);
    assert.equal(s.store.toolCalls.length, 1);
  });
  it('honors cancellation before the first agent step', async () => {
    const s = await setup(graph());
    await s.store.updateRun(s.run.id, {
      cancellationRequestedAt: new Date().toISOString(),
      cancellationReason: 'stop',
    });
    const executor = new RunExecutor(
      s.store,
      client(() => ({ type: 'FINAL', output: { text: 'unexpected' }, action_summary: 'finish' })),
      logger,
    );
    assert.equal(
      await executor.execute((await s.store.getRunById(s.run.id))!, s.version),
      'CANCELLED',
    );
    assert.equal(s.store.agentSteps.length, 0);
  });
  it('enforces the active-duration limit after provider latency', async () => {
    const timed = graph(false);
    const agent = timed.nodes.find((node) => node.type === 'AGENT');
    if (!agent || agent.type !== 'AGENT') throw new Error();
    agent.config.max_duration_ms = 1000;
    const s = await setup(timed);
    const slow = client((asyncAction) => ({
      type: 'FINAL',
      output: { text: 'late' },
      action_summary: 'late',
    }));
    slow.selectAgentAction = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 1050));
      return {
        action: { type: 'FINAL', output: { text: 'late' }, action_summary: 'late' },
        provider: 'development',
        model: request.model,
        latency_ms: 1050,
        input_tokens: null,
        output_tokens: null,
      };
    };
    const executor = new RunExecutor(s.store, slow, logger);
    await executor.execute(s.run, s.version);
    assert.equal(
      ((await s.store.getRunById(s.run.id))?.output?.agent as Record<string, unknown>).limit_reason,
      'MAX_DURATION',
    );
  });
  it('enforces provider-reported token budgets without fabricating missing usage', async () => {
    const budgeted = graph();
    const agent = budgeted.nodes.find((node) => node.type === 'AGENT');
    if (!agent || agent.type !== 'AGENT') throw new Error();
    agent.config.max_total_tokens = 100;
    const s = await setup(budgeted);
    const measured = client(() => ({
      type: 'FINAL',
      output: { text: 'too expensive' },
      action_summary: 'finish',
    }));
    measured.selectAgentAction = async (request) => ({
      action: { type: 'FINAL', output: { text: 'too expensive' }, action_summary: 'finish' },
      provider: 'development',
      model: request.model,
      latency_ms: 0,
      input_tokens: 60,
      output_tokens: 50,
    });
    const executor = new RunExecutor(s.store, measured, logger);
    await executor.execute(s.run, s.version);
    assert.equal(
      ((await s.store.getRunById(s.run.id))?.output?.agent as Record<string, unknown>).limit_reason,
      'MAX_TOTAL_TOKENS',
    );
    assert.equal(s.store.agentExecutions[0]?.totalTokens, 110);
  });
});
