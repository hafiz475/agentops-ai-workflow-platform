import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Edge } from '@xyflow/react';
import { createWorkflowNode, graphFromCanvas, pollingIntervalForStatus } from './WorkflowEditor';

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

  it('polls queued/running runs and stops for terminal results', () => {
    assert.equal(pollingIntervalForStatus('QUEUED'), 800);
    assert.equal(pollingIntervalForStatus('RUNNING'), 800);
    assert.equal(pollingIntervalForStatus('COMPLETED'), false);
    assert.equal(pollingIntervalForStatus('FAILED'), false);
  });
});
