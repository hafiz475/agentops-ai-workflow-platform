import { z } from 'zod';
import {
  httpRequestNodeSchema,
  type AgentToolDefinition,
  type AgentToolName,
  type WorkflowNode,
} from '@agentops/contracts';
import type { EmbeddingServiceClient } from './ai-client.js';
import type { RunLogger } from './executor.js';
import type { Store } from './store.js';
import { executeHttpRequest } from './http-tool.js';
import { renderStructuredValue } from './tool-values.js';
import { executeRetrieval } from './retrieval-tool.js';

const retrievalInput = z
  .object({
    knowledge_source_id: z.string().uuid(),
    query: z.string().min(1),
    top_k: z.number().int().min(1).max(20).default(5),
    document_id: z.string().uuid().optional(),
  })
  .strict();
const transformInput = z
  .object({
    template: z.record(z.string(), z.unknown()),
    input: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const httpInput = httpRequestNodeSchema.shape.config;

export interface ToolContext {
  store: Store;
  embeddings?: EmbeddingServiceClient;
  logger: RunLogger;
  projectId: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  secrets: Record<string, Record<string, string>>;
}
export class ToolRegistry {
  public definitions(names: AgentToolName[]): AgentToolDefinition[] {
    return names.map((name) => ({
      name,
      description:
        name === 'retrieval'
          ? 'Search a project-scoped Knowledge Source.'
          : name === 'http_request'
            ? 'Make an SSRF-protected HTTP request.'
            : 'Apply a deterministic structured template.',
      input_schema:
        name === 'retrieval'
          ? {
              type: 'object',
              additionalProperties: false,
              required: ['knowledge_source_id', 'query'],
              properties: {
                knowledge_source_id: { type: 'string', format: 'uuid' },
                query: { type: 'string', minLength: 1 },
                top_k: { type: 'integer', minimum: 1, maximum: 20 },
                document_id: { type: 'string', format: 'uuid' },
              },
            }
          : name === 'http_request'
            ? {
                type: 'object',
                additionalProperties: false,
                required: ['method', 'url'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  method: { enum: ['GET', 'POST', 'PUT', 'PATCH'] },
                  headers: { type: 'object' },
                  query: { type: 'object' },
                  body: {},
                  timeout_ms: { type: 'integer', minimum: 100, maximum: 30000 },
                  max_response_bytes: { type: 'integer', minimum: 1024, maximum: 5242880 },
                  retry_non_idempotent: { type: 'boolean' },
                  idempotency_key_header: { type: 'string' },
                },
              }
            : {
                type: 'object',
                additionalProperties: false,
                required: ['template'],
                properties: {
                  template: { type: 'object' },
                  input: { type: 'object' },
                },
              },
      sensitivity: name === 'http_request' ? 'HIGH' : 'LOW',
    }));
  }
  public validate(name: AgentToolName, args: Record<string, unknown>): Record<string, unknown> {
    return (
      name === 'retrieval' ? retrievalInput : name === 'http_request' ? httpInput : transformInput
    ).parse(args);
  }
  public safeArguments(
    name: AgentToolName,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (name === 'retrieval') {
      const parsed = retrievalInput.parse(args);
      return {
        knowledge_source_id: parsed.knowledge_source_id,
        query_length: parsed.query.length,
        top_k: parsed.top_k,
        document_id: parsed.document_id ?? null,
      };
    }
    if (name === 'transform') {
      const parsed = transformInput.parse(args);
      return {
        template_fields: Object.keys(parsed.template),
        input_fields: Object.keys(parsed.input),
      };
    }
    const parsed = httpInput.parse(args);
    const url = new URL(parsed.url);
    return {
      method: parsed.method,
      destination: `${url.origin}${url.pathname}`,
      header_names: Object.keys(parsed.headers),
      query_keys: Object.keys(parsed.query ?? {}),
      body_preview: parsed.body === undefined ? null : '<redacted>',
      timeout_ms: parsed.timeout_ms,
      max_response_bytes: parsed.max_response_bytes,
    };
  }
  public async execute(
    name: AgentToolName,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const parsed = this.validate(name, args);
    if (name === 'transform') {
      const value = renderStructuredValue(
        (parsed as z.infer<typeof transformInput>).template,
        (parsed as z.infer<typeof transformInput>).input,
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Transform result must be an object.');
      return value as Record<string, unknown>;
    }
    if (name === 'http_request') {
      const config = parsed as z.infer<typeof httpInput>;
      const node = {
        id: context.nodeId,
        type: 'HTTP_REQUEST',
        position: { x: 0, y: 0 },
        config,
      } as Extract<WorkflowNode, { type: 'HTTP_REQUEST' }>;
      return executeHttpRequest(node, {
        projectId: context.projectId,
        runId: context.runId,
        nodeId: context.nodeId,
        input: {},
        secrets: context.secrets,
      });
    }
    if (!context.embeddings) throw new Error('Embedding service is unavailable.');
    const input = parsed as z.infer<typeof retrievalInput>;
    return executeRetrieval({
      knowledgeSourceId: input.knowledge_source_id,
      query: input.query,
      topK: input.top_k,
      ...(input.document_id ? { documentId: input.document_id } : {}),
      projectId: context.projectId,
      runId: context.runId,
      nodeRunId: context.nodeRunId,
      nodeId: context.nodeId,
      store: context.store,
      embeddings: context.embeddings,
      logger: context.logger,
    });
  }
}
