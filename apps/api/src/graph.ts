import { workflowGraphSchema, type WorkflowGraph, type WorkflowNode } from '@agentops/contracts';

export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  executionOrder: string[];
}

export interface PromptTemplateValidationResult {
  valid: boolean;
  variables: string[];
  errors: string[];
}

export const validatePromptTemplate = (
  template: string,
  allowedVariables: readonly string[] = ['input'],
): PromptTemplateValidationResult => {
  const errors: string[] = [];
  const variables: string[] = [];
  const placeholderPattern = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;
  for (const match of template.matchAll(/{{([\s\S]*?)}}/g)) {
    const expression = match[1]?.trim() ?? '';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expression)) {
      errors.push(`Unsafe prompt expression: {{${expression}}}.`);
    }
  }
  for (const match of template.matchAll(placeholderPattern)) {
    const variable = match[1];
    if (!variable) continue;
    variables.push(variable);
    if (!allowedVariables.includes(variable))
      errors.push(`Unknown template variable: ${variable}.`);
  }
  const stripped = template.replace(placeholderPattern, '');
  if (stripped.includes('{{') || stripped.includes('}}')) {
    errors.push('Prompt contains an invalid or unclosed placeholder.');
  }
  return { valid: errors.length === 0, variables: [...new Set(variables)].sort(), errors };
};

const countType = (nodes: WorkflowNode[], type: WorkflowNode['type']): number =>
  nodes.filter((node) => node.type === type).length;

export const validateWorkflowGraph = (input: unknown): GraphValidationResult => {
  const parsed = workflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      executionOrder: [],
    };
  }

  const graph: WorkflowGraph = parsed.data;
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (nodeIds.size !== graph.nodes.length) errors.push('Node IDs must be unique.');
  if (countType(graph.nodes, 'INPUT') !== 1) errors.push('Exactly one INPUT node is required.');
  if (countType(graph.nodes, 'OUTPUT') !== 1) errors.push('Exactly one OUTPUT node is required.');
  if (countType(graph.nodes, 'PROMPT') < 1) errors.push('At least one PROMPT node is required.');
  if (countType(graph.nodes, 'LLM') !== 1) errors.push('Exactly one LLM node is required.');

  for (const node of graph.nodes) {
    if (node.type === 'PROMPT' && 'template' in node.config) {
      errors.push(...validatePromptTemplate(node.config.template).errors);
    }
  }

  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references a missing node.`);
    }
    if (edge.source === edge.target)
      errors.push(`Edge ${edge.id} cannot connect a node to itself.`);
    const key = `${edge.source}->${edge.target}`;
    if (edgeKeys.has(key)) errors.push(`Duplicate edge ${key} is not allowed.`);
    edgeKeys.add(key);
  }

  if (errors.length > 0) return { valid: false, errors: [...new Set(errors)], executionOrder: [] };

  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const inputNode = graph.nodes.find((node) => node.type === 'INPUT');
  const outputNode = graph.nodes.find((node) => node.type === 'OUTPUT');
  for (const node of graph.nodes) {
    const inputCount = indegree.get(node.id) ?? 0;
    const outputCount = outgoing.get(node.id)?.length ?? 0;
    if (node.type === 'INPUT' && inputCount !== 0)
      errors.push('INPUT must not have an incoming edge.');
    if (node.type !== 'INPUT' && inputCount !== 1)
      errors.push(`${node.type} node ${node.id} must have exactly one incoming edge.`);
    if (node.type === 'OUTPUT' && outputCount !== 0)
      errors.push('OUTPUT must not have an outgoing edge.');
    if (node.type !== 'OUTPUT' && outputCount !== 1)
      errors.push(`${node.type} node ${node.id} must have exactly one outgoing edge.`);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const target of [...(outgoing.get(id) ?? [])].sort()) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
    queue.sort();
  }

  if (order.length !== graph.nodes.length) errors.push('Workflow contains a cycle.');
  if (inputNode && outputNode) {
    const visited = new Set<string>();
    const stack = [inputNode.id];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      stack.push(...(outgoing.get(id) ?? []));
    }
    if (!visited.has(outputNode.id)) errors.push('OUTPUT is not reachable from INPUT.');
    if (visited.size !== graph.nodes.length)
      errors.push('Workflow must be one connected execution path.');
  }

  const types = order.map((id) => graph.nodes.find((node) => node.id === id)?.type);
  if (errors.length === 0 && (types[0] !== 'INPUT' || types.at(-1) !== 'OUTPUT')) {
    errors.push('Execution order must start with INPUT and end with OUTPUT.');
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    executionOrder: errors.length === 0 ? order : [],
  };
};

export const renderPrompt = (template: string, values: Record<string, string>): string => {
  const validation = validatePromptTemplate(template, Object.keys(values));
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return template.replace(
    /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g,
    (_match, variable: string) => values[variable] ?? '',
  );
};
