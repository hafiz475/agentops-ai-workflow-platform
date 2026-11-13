import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Edge } from '@xyflow/react';
import {
  createWorkflowNode,
  graphFromCanvas,
  parseConditionValue,
  pollingIntervalForStatus,
  traceSummary,
} from './WorkflowEditor';

describe('workflow editor state', () => {
  it('adds typed nodes with safe default configuration and serializes edges', () => {
    const input = createWorkflowNode('INPUT', 0, 'input');
    const prompt = createWorkflowNode('PROMPT', 1, 'prompt');
    const graph = graphFromCanvas(
      [input, prompt],
      [{ id: 'edge', source: 'input', target: 'prompt' } as Edge],
    );
    assert.equal(graph.nodes[0]?.type, 'INPUT');
    assert.deepEqual(graph.nodes[1]?.config, {
      template: 'Answer this clearly for a beginner: {{input}}',
    });
    assert.deepEqual(graph.edges, [{ id: 'edge', source: 'input', target: 'prompt' }]);
  });

  it('adds Milestone 4 nodes and serializes labeled CONDITION branches', () => {
    const condition = createWorkflowNode('CONDITION', 0, 'condition');
    const transform = createWorkflowNode('TRANSFORM', 1, 'transform');
    const http = createWorkflowNode('HTTP_REQUEST', 2, 'http');
    const graph = graphFromCanvas(
      [condition, transform, http],
      [
        {
          id: 'true-edge',
          source: 'condition',
          sourceHandle: 'true',
          target: 'transform',
        } as Edge,
      ],
    );
    assert.equal(graph.nodes[0]?.type, 'CONDITION');
    assert.deepEqual(graph.nodes[1]?.config, {
      output: { text: '{{text}}', status: 'processed' },
    });
    assert.equal(graph.nodes[2]?.type, 'HTTP_REQUEST');
    assert.equal(graph.edges[0]?.branch, 'true');
  });

  it('summarizes branch, skipped, HTTP success, and HTTP blocked traces', () => {
    assert.equal(parseConditionValue('7'), 7);
    assert.equal(parseConditionValue('true'), true);
    assert.equal(
      traceSummary({ eventType: 'CONDITION_EVALUATED', metadata: { condition_result: true } }),
      'result: TRUE',
    );
    assert.equal(
      traceSummary({ eventType: 'BRANCH_SELECTED', metadata: { selected_branch: 'false' } }),
      'FALSE branch selected',
    );
    assert.match(traceSummary({ eventType: 'NODE_SKIPPED', metadata: {} }), /skipped/);
    assert.match(
      traceSummary({
        eventType: 'HTTP_REQUEST_COMPLETED',
        metadata: { method: 'POST', host: 'api.example.com', status: 200, latency_ms: 430 },
      }),
      /POST.*200.*430 ms/,
    );
    assert.match(
      traceSummary({
        eventType: 'HTTP_REQUEST_BLOCKED',
        metadata: { method: 'GET', host: 'localhost', reason: 'Destination is private.' },
      }),
      /private/,
    );
  });

  it('polls queued/running runs and stops for terminal results', () => {
    assert.equal(pollingIntervalForStatus('QUEUED'), 800);
    assert.equal(pollingIntervalForStatus('RUNNING'), 800);
    assert.equal(pollingIntervalForStatus('COMPLETED'), false);
    assert.equal(pollingIntervalForStatus('FAILED'), false);
  });

  it('adds RETRIEVAL nodes and summarizes ranked retrieval and citations', () => {
    const retrieval = createWorkflowNode('RETRIEVAL', 0, 'retrieval');
    assert.deepEqual(retrieval.data.config, {
      knowledge_source_id: '',
      query_path: 'input',
      top_k: 5,
    });
    assert.match(
      traceSummary({
        eventType: 'RETRIEVAL_COMPLETED',
        metadata: { result_count: 3, latency_ms: 12 },
      }),
      /3 ranked sources.*12 ms/,
    );
    assert.match(
      traceSummary({
        eventType: 'CITATIONS_VALIDATED',
        metadata: { cited_chunk_ids: ['chunk'] },
      }),
      /1 citations validated/,
    );
  });
  it('adds bounded AGENT nodes and summarizes its safe timeline', () => {
    const agent = createWorkflowNode('AGENT', 0, 'agent');
    assert.deepEqual(agent.data.config, {
      model: 'development-agent-v1',
      allowed_tools: ['retrieval', 'transform'],
      max_steps: 5,
      max_duration_ms: 60000,
      max_tool_calls: 5,
      max_total_tokens: 10000,
      require_approval_for: [],
    });
    assert.match(
      traceSummary({
        eventType: 'TOOL_CALL_COMPLETED',
        metadata: { step_number: 2, tool_name: 'transform' },
      }),
      /step 2.*transform/,
    );
    assert.match(
      traceSummary({ eventType: 'AGENT_LIMIT_REACHED', metadata: { reason: 'MAX_STEPS' } }),
      /MAX_STEPS/,
    );
    assert.match(
      traceSummary({
        eventType: 'AGENT_WAITING_FOR_APPROVAL',
        metadata: { step_number: 2, tool_name: 'http_request' },
      }),
      /step 2.*http_request/,
    );
    assert.match(
      traceSummary({
        eventType: 'AGENT_RESUMED',
        metadata: { step_number: 2, reason: 'APPROVED' },
      }),
      /APPROVED/,
    );
    assert.match(
      traceSummary({ eventType: 'AGENT_COMPLETED', metadata: { status: 'COMPLETED' } }),
      /COMPLETED/,
    );
    assert.match(
      traceSummary({ eventType: 'AGENT_FAILED', metadata: { message: 'provider failed' } }),
      /provider failed/,
    );
  });
});
