import { z } from 'zod';

export const serviceStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const nodeBaseSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  position: positionSchema,
});

export const inputNodeSchema = nodeBaseSchema.extend({
  type: z.literal('INPUT'),
  config: z.object({}).strict(),
});
export const promptNodeSchema = nodeBaseSchema.extend({
  type: z.literal('PROMPT'),
  config: z.object({ template: z.string().min(1) }).strict(),
});
export const llmNodeSchema = nodeBaseSchema.extend({
  type: z.literal('LLM'),
  config: z
    .object({
      provider: z.string().min(1).default('configured-default'),
      model: z.string().min(1),
      temperature: z.number().min(0).max(2).default(0),
    })
    .strict(),
});
export const outputNodeSchema = nodeBaseSchema.extend({
  type: z.literal('OUTPUT'),
  config: z.object({}).strict(),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  inputNodeSchema,
  promptNodeSchema,
  llmNodeSchema,
  outputNodeSchema,
]);
export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});
export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const generateRequestSchema = z.object({
  run_id: z.string().uuid(),
  node_id: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
});
export const generateResponseSchema = z.object({
  text: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  latency_ms: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

export const runStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export const nodeRunStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
export type RunStatus = z.infer<typeof runStatusSchema>;
export type NodeRunStatus = z.infer<typeof nodeRunStatusSchema>;
