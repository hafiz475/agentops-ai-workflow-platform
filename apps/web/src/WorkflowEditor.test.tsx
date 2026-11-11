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
});
