import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowGraph } from '@agentops/contracts';
import { renderPrompt, validateWorkflowGraph } from '../src/graph.js';

const validGraph = (): WorkflowGraph => ({
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'prompt',
      type: 'PROMPT',
      version: 1,
      position: { x: 100, y: 0 },
      config: { template: 'Explain: {{input}}' },
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
    { id: 'e1', source: 'input', target: 'prompt' },
    { id: 'e2', source: 'prompt', target: 'llm' },
    { id: 'e3', source: 'llm', target: 'output' },
  ],
});

describe('workflow graph validation', () => {
  it('accepts and deterministically orders the supported linear graph', () => {
    assert.deepEqual(validateWorkflowGraph(validGraph()), {
      valid: true,
      errors: [],
      executionOrder: ['input', 'prompt', 'llm', 'output'],
    });
  });

  for (const [name, mutate, message] of [
    [
      'missing INPUT',
      (graph: WorkflowGraph) => {
        graph.nodes = graph.nodes.filter((node) => node.type !== 'INPUT');
        graph.edges = graph.edges.filter((edge) => edge.source !== 'input');
      },
      'Exactly one INPUT',
    ],
    [
      'missing OUTPUT',
      (graph: WorkflowGraph) => {
        graph.nodes = graph.nodes.filter((node) => node.type !== 'OUTPUT');
        graph.edges = graph.edges.filter((edge) => edge.target !== 'output');
      },
      'At least one OUTPUT',
    ],
    [
      'duplicate INPUT',
      (graph: WorkflowGraph) => {
        graph.nodes.push({
          id: 'input2',
          type: 'INPUT',
          version: 1,
          position: { x: 0, y: 1 },
          config: {},
        });
      },
      'Exactly one INPUT',
    ],
    [
      'disconnected second OUTPUT',
      (graph: WorkflowGraph) => {
        graph.nodes.push({
          id: 'output2',
          type: 'OUTPUT',
          version: 1,
          position: { x: 4, y: 0 },
          config: {},
        });
      },
      'exactly one incoming',
    ],
    [
      'invalid edge',
      (graph: WorkflowGraph) => {
        graph.edges.push({ id: 'bad', source: 'missing', target: 'output' });
      },
      'missing node',
    ],
    [
      'disconnected node',
      (graph: WorkflowGraph) => {
        graph.nodes.push({
          id: 'prompt2',
          type: 'PROMPT',
          version: 1,
          position: { x: 0, y: 1 },
          config: { template: '{{input}}' },
        });
      },
      'exactly one incoming',
    ],
    [
      'cycle',
      (graph: WorkflowGraph) => {
        graph.edges.push({ id: 'cycle', source: 'output', target: 'input' });
      },
      'cycle',
    ],
  ] as const) {
    it(`rejects ${name}`, () => {
      const graph = validGraph();
      mutate(graph);
      assert.match(validateWorkflowGraph(graph).errors.join(' '), new RegExp(message, 'i'));
    });
  }

  it('reports an OUTPUT that is not reachable from INPUT', () => {
    const graph = validGraph();
    graph.edges = graph.edges.filter((edge) => edge.target !== 'output');
    assert.match(
      validateWorkflowGraph(graph).errors.join(' '),
      /At least one OUTPUT must be reachable from INPUT/i,
    );
  });

  it('rejects missing node configuration through the strict schema', () => {
    const graph = validGraph() as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: WorkflowGraph['edges'];
    };
    const prompt = graph.nodes.find((node) => node.type === 'PROMPT');
    if (prompt) prompt.config = {};
    assert.equal(validateWorkflowGraph(graph).valid, false);
  });

  it('renders controlled input variables and rejects unknown variables', () => {
    assert.equal(renderPrompt('Explain {{input}}', { input: 'Docker' }), 'Explain Docker');
    assert.throws(
      () => renderPrompt('{{secret}}', { input: 'Docker' }),
      /Unknown template variable/,
    );
  });
});
