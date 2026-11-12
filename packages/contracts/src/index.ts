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
export const inlinePromptConfigSchema = z.object({ template: z.string().min(1) }).strict();
export const versionedPromptConfigSchema = z
  .object({ prompt_version_id: z.string().uuid() })
  .strict();
export const promptNodeSchema = nodeBaseSchema.extend({
  type: z.literal('PROMPT'),
  config: z.union([inlinePromptConfigSchema, versionedPromptConfigSchema]),
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
export const humanApprovalNodeSchema = nodeBaseSchema.extend({
  type: z.literal('HUMAN_APPROVAL'),
  config: z
    .object({
      title: z.string().min(1),
      instructions: z.string().min(1),
      allow_reject: z.boolean().default(true),
    })
    .strict(),
});
export const conditionOperatorSchema = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'NOT_CONTAINS',
  'EXISTS',
  'NOT_EXISTS',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'STARTS_WITH',
  'ENDS_WITH',
]);
export const conditionNodeSchema = nodeBaseSchema.extend({
  type: z.literal('CONDITION'),
  config: z
    .object({
      path: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/),
      operator: conditionOperatorSchema,
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    })
    .strict(),
});
const transformValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(transformValueSchema),
    z.record(z.string(), transformValueSchema),
  ]),
);
export const transformNodeSchema = nodeBaseSchema.extend({
  type: z.literal('TRANSFORM'),
  config: z.object({ output: z.record(z.string(), transformValueSchema) }).strict(),
});
export const secretReferenceSchema = z
  .object({ secret_ref: z.string().regex(/^[a-zA-Z0-9_-]+$/) })
  .strict();
const httpHeaderValueSchema = z.union([z.string(), secretReferenceSchema]);
export const httpRequestNodeSchema = nodeBaseSchema.extend({
  type: z.literal('HTTP_REQUEST'),
  config: z
    .object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH']),
      url: z.string().url(),
      headers: z.record(z.string(), httpHeaderValueSchema).default({}),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      body: transformValueSchema.optional(),
      timeout_ms: z.number().int().min(100).max(30_000).default(10_000),
      max_response_bytes: z.number().int().min(1_024).max(5_242_880).default(1_048_576),
      retry_non_idempotent: z.boolean().default(false),
      idempotency_key_header: z.string().min(1).max(100).optional(),
    })
    .strict()
    .superRefine((config, context) => {
      const forbiddenHeaders = new Set([
        'host',
        'connection',
        'content-length',
        'transfer-encoding',
        'upgrade',
        'proxy-authorization',
        'x-forwarded-host',
      ]);
      for (const name of Object.keys(config.headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
          context.addIssue({ code: 'custom', message: `Invalid HTTP header name: ${name}.` });
        if (forbiddenHeaders.has(name.toLowerCase()))
          context.addIssue({ code: 'custom', message: `HTTP header ${name} is not allowed.` });
      }
      if (
        config.retry_non_idempotent &&
        config.method !== 'GET' &&
        !config.idempotency_key_header
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Non-idempotent retries require idempotency_key_header.',
        });
      }
      if (config.method === 'GET' && config.body !== undefined) {
        context.addIssue({ code: 'custom', message: 'GET requests cannot include a body.' });
      }
    }),
});
export const retrievalNodeSchema = nodeBaseSchema.extend({
  type: z.literal('RETRIEVAL'),
  config: z
    .object({
      knowledge_source_id: z.string().uuid(),
      query_path: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/),
      top_k: z.number().int().min(1).max(20).default(5),
      document_id: z.string().uuid().optional(),
    })
    .strict(),
});
export const workflowNodeSchema = z.discriminatedUnion('type', [
  inputNodeSchema,
  promptNodeSchema,
  llmNodeSchema,
  humanApprovalNodeSchema,
  conditionNodeSchema,
  transformNodeSchema,
  httpRequestNodeSchema,
  retrievalNodeSchema,
  outputNodeSchema,
]);
export const workflowEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    branch: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const evaluatorConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EXACT_MATCH') }).strict(),
  z.object({ type: z.literal('CONTAINS'), values: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ type: z.literal('NOT_CONTAINS'), values: z.array(z.string().min(1)).min(1) }).strict(),
  z
    .object({
      type: z.literal('REGEX'),
      pattern: z.string().min(1),
      flags: z
        .string()
        .regex(/^[im]*$/)
        .default(''),
    })
    .strict(),
  z.object({ type: z.literal('JSON_SCHEMA'), schema: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal('RETRIEVAL_HIT_AT_K'), k: z.number().int().min(1).max(20) }).strict(),
  z
    .object({ type: z.literal('RETRIEVAL_RECALL_AT_K'), k: z.number().int().min(1).max(20) })
    .strict(),
  z.object({ type: z.literal('RETRIEVAL_MRR') }).strict(),
  z
    .object({
      type: z.literal('CITATION_MATCH'),
      required_chunk_ids: z.array(z.string().uuid()).default([]),
      forbidden_chunk_ids: z.array(z.string().uuid()).default([]),
    })
    .strict(),
]);
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;

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

export const embeddingRequestSchema = z.object({
  texts: z.array(z.string().min(1).max(100_000)).min(1).max(128),
  provider: z.enum(['development', 'openai']),
  model: z.string().min(1).max(200),
});
export const embeddingResponseSchema = z.object({
  vectors: z.array(z.array(z.number().finite()).min(1)).min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  latency_ms: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative().nullable(),
});
export type EmbeddingRequest = z.infer<typeof embeddingRequestSchema>;
export type EmbeddingResponse = z.infer<typeof embeddingResponseSchema>;

export const runStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const nodeRunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);
export const approvalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const evaluationRunStatusSchema = runStatusSchema;
export const evaluationCaseStatusSchema = z.enum(['RUNNING', 'COMPLETED', 'FAILED']);
export type RunStatus = z.infer<typeof runStatusSchema>;
export type NodeRunStatus = z.infer<typeof nodeRunStatusSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type EvaluationRunStatus = z.infer<typeof evaluationRunStatusSchema>;
export type EvaluationCaseStatus = z.infer<typeof evaluationCaseStatusSchema>;
