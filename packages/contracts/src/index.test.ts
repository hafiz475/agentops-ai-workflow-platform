import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluatorConfigSchema,
  generateResponseSchema,
  serviceStatusSchema,
  workflowGraphSchema,
} from './index.js';

describe('contracts', () => {
  it('rejects an invalid service response', () => {
    assert.throws(() => serviceStatusSchema.parse({ status: 'maybe' }));
  });

  it('validates a typed workflow graph', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [
        { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
        {
          id: 'prompt',
          type: 'PROMPT',
          version: 1,
          position: { x: 100, y: 0 },
          config: { template: '{{input}}' },
        },
        {
          id: 'llm',
          type: 'LLM',
          version: 1,
          position: { x: 200, y: 0 },
          config: { provider: 'configured-default', model: 'configured-default', temperature: 0 },
        },
        { id: 'output', type: 'OUTPUT', version: 1, position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'a', source: 'input', target: 'prompt' },
        { id: 'b', source: 'prompt', target: 'llm' },
        { id: 'c', source: 'llm', target: 'output' },
      ],
    });
    assert.equal(graph.nodes.length, 4);
  });

  it('validates versioned prompts and deterministic evaluator contracts', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [
        {
          id: 'prompt',
          type: 'PROMPT',
          version: 1,
          position: { x: 0, y: 0 },
          config: { prompt_version_id: '00000000-0000-4000-8000-000000000001' },
        },
      ],
      edges: [],
    });
    assert.equal(graph.nodes[0]?.type, 'PROMPT');
    assert.equal(evaluatorConfigSchema.parse({ type: 'REGEX', pattern: '^ok$' }).type, 'REGEX');
    assert.throws(() => evaluatorConfigSchema.parse({ type: 'REGEX' }));
  });
  it('rejects unchecked node configuration and invalid AI responses', () => {
    assert.throws(() =>
      workflowGraphSchema.parse({
        nodes: [
          {
            id: 'input',
            type: 'INPUT',
            version: 1,
            position: { x: 0, y: 0 },
            config: { unsafe: true },
          },
        ],
        edges: [],
      }),
    );
    assert.throws(() => generateResponseSchema.parse({ text: 'missing metadata' }));
  });

  it('validates Milestone 4 nodes and branch metadata', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [
        {
          id: 'condition',
          type: 'CONDITION',
          version: 1,
          position: { x: 0, y: 0 },
          config: { path: 'result.status', operator: 'EQUALS', value: 'PASS' },
        },
        {
          id: 'transform',
          type: 'TRANSFORM',
          version: 1,
          position: { x: 1, y: 0 },
          config: { output: { message: '{{text}}', status: 'processed' } },
        },
        {
          id: 'http',
          type: 'HTTP_REQUEST',
          version: 1,
          position: { x: 2, y: 0 },
          config: {
            method: 'POST',
            url: 'https://api.example.com/items',
            headers: { authorization: { secret_ref: 'api-token' } },
            body: { message: '{{message}}' },
            timeout_ms: 10_000,
            max_response_bytes: 1_048_576,
            retry_non_idempotent: false,
          },
        },
      ],
      edges: [{ id: 'true', source: 'condition', target: 'transform', branch: 'true' }],
    });
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges[0]?.branch, 'true');
    assert.throws(() =>
      workflowGraphSchema.parse({
        nodes: [],
        edges: [{ id: 'bad', source: 'a', target: 'b', branch: 'maybe' }],
      }),
    );
  });
});
