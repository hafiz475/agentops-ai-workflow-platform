import type { GenerateResponse, WorkflowGraph, WorkflowNode } from '@agentops/contracts';
import type { AiServiceClient, EmbeddingServiceClient } from './ai-client.js';
import { TransientAiError, TransientEmbeddingError } from './ai-client.js';
import { renderPrompt, validateWorkflowGraph } from './graph.js';
import type { RunRecord, Store, WorkflowVersionRecord } from './store.js';
import { executeHttpRequest, HttpToolBlockedError, HttpToolTransientError } from './http-tool.js';
import { evaluateCondition, readPath, renderStructuredValue } from './tool-values.js';
import {
  rankRetrievalResults,
  renderRetrievalContext,
  validateCitations,
  type RankedRetrievalResult,
} from './retrieval.js';

export interface RunLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}
export type ExecutionOutcome = 'COMPLETED' | 'WAITING_FOR_APPROVAL' | 'CANCELLED' | 'FAILED';
export class TransientExecutionError extends Error {}

export class RunExecutor {
  public constructor(
    private readonly store: Store,
    private readonly aiClient: AiServiceClient,
    private readonly logger: RunLogger,
    private readonly workflowTimeoutMs = 120_000,
    private readonly toolSecrets: Record<string, Record<string, string>> = {},
    private readonly embeddings?: EmbeddingServiceClient,
  ) {}

  public async execute(run: RunRecord, version: WorkflowVersionRecord): Promise<ExecutionOutcome> {
    const context = {
      project_id: run.projectId,
      workflow_id: run.workflowId,
      workflow_version_id: version.id,
      run_id: run.id,
    };
    const current = await this.store.getRunById(run.id);
    if (!current || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status))
      return current?.status === 'COMPLETED'
        ? 'COMPLETED'
        : current?.status === 'CANCELLED'
          ? 'CANCELLED'
          : 'FAILED';
    const validation = validateWorkflowGraph(version.graph);
    if (!validation.valid)
      return this.failRun(run.id, 'INVALID_VERSION', validation.errors.join(' '), context);

    const started = Date.now();
    const existingNodeRuns = await this.store.listNodeRuns(run.id);
    const waitingApprovalNode = existingNodeRuns.find(
      (nodeRun) => nodeRun.nodeType === 'HUMAN_APPROVAL' && nodeRun.status === 'WAITING',
    );
    const waitingApproval = waitingApprovalNode
      ? await this.store.getApprovalForNodeRun(waitingApprovalNode.id)
      : null;
    const isResume = waitingApproval?.status === 'APPROVED';
    const priorStatus = current.status;
    await this.store.updateRun(run.id, {
      status: 'RUNNING',
      // PostgreSQL drivers return timestamps as Date objects. The store's public
      // record is serializable, so an existing value may no longer be a safe SQL
      // timestamp literal when it reaches us again. It also does not need to be
      // rewritten while resuming an approval-paused run.
      ...(current.startedAt ? {} : { startedAt: new Date().toISOString() }),
    });
    if (priorStatus !== 'RUNNING')
      await this.store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: isResume ? 'RUN_RESUMED' : 'RUN_STARTED',
        metadata: {},
      });
    this.logger.info(context, isResume ? 'worker.run_resumed' : 'worker.run_started');
    let value: Record<string, unknown> = run.input;
    let active: { id: string; node: WorkflowNode } | null = null;

    try {
      let nodeId: string | undefined = version.graph.nodes.find(
        (node) => node.type === 'INPUT',
      )?.id;
      while (nodeId) {
        if (Date.now() - started > this.workflowTimeoutMs) {
          await this.store.addTrace({
            runId: run.id,
            nodeRunId: null,
            eventType: 'RUN_TIMEOUT',
            metadata: { timeout_ms: this.workflowTimeoutMs },
          });
          return this.failRun(
            run.id,
            'WORKFLOW_TIMEOUT',
            'Workflow execution exceeded its timeout.',
            context,
          );
        }
        const authoritative = await this.store.getRunById(run.id);
        if (authoritative?.cancellationRequestedAt || authoritative?.status === 'CANCELLED')
          return this.cancelRun(
            run.id,
            authoritative.cancellationReason ?? 'Cancellation requested.',
            context,
          );
        const node = version.graph.nodes.find((item) => item.id === nodeId);
        if (!node) throw new Error(`Validated node ${nodeId} is missing.`);
        let nodeRun = await this.store.getNodeRun(run.id, node.id);
        if (nodeRun?.status === 'COMPLETED' && nodeRun.output) {
          value = nodeRun.output;
          nodeId = await this.nextNode(version.graph, node, value, run.id);
          continue;
        }

        if (node.type === 'HUMAN_APPROVAL' && nodeRun?.status === 'WAITING') {
          const approval = await this.store.getApprovalForNodeRun(nodeRun.id);
          if (approval?.status === 'PENDING') return 'WAITING_FOR_APPROVAL';
          if (approval?.status === 'REJECTED' || approval?.status === 'CANCELLED')
            return this.cancelRun(run.id, approval.reason ?? 'HUMAN_REJECTED', context);
          if (approval?.status === 'APPROVED') {
            value = nodeRun.input ?? value;
            await this.store.updateNodeRun(nodeRun.id, {
              status: 'COMPLETED',
              output: value,
              completedAt: new Date().toISOString(),
            });
            await this.store.addTrace({
              runId: run.id,
              nodeRunId: nodeRun.id,
              eventType: 'NODE_COMPLETED',
              metadata: { node_id: node.id, node_type: node.type },
            });
            nodeId = await this.nextNode(version.graph, node, value, run.id);
            continue;
          }
        }

        nodeRun = await this.store.createNodeRun({
          runId: run.id,
          nodeId: node.id,
          nodeType: node.type,
        });
        active = { id: nodeRun.id, node };
        await this.store.updateNodeRun(nodeRun.id, {
          status: 'RUNNING',
          input: value,
          startedAt: nodeRun.startedAt ?? new Date().toISOString(),
        });
        await this.store.addTrace({
          runId: run.id,
          nodeRunId: nodeRun.id,
          eventType: 'NODE_STARTED',
          metadata: { node_id: node.id, node_type: node.type },
        });
        this.logger.info({ ...context, node_id: node.id }, 'worker.node_started');

        if (node.type === 'HUMAN_APPROVAL') {
          const approval = await this.store.createApproval({
            projectId: run.projectId,
            runId: run.id,
            nodeRunId: nodeRun.id,
            title: node.config.title,
            instructions: node.config.instructions,
          });
          await this.store.updateNodeRun(nodeRun.id, { status: 'WAITING' });
          await this.store.updateRun(run.id, { status: 'WAITING_FOR_APPROVAL' });
          await this.store.addTrace({
            runId: run.id,
            nodeRunId: nodeRun.id,
            eventType: 'APPROVAL_REQUESTED',
            metadata: { approval_id: approval.id, title: approval.title },
          });
          await this.store.addTrace({
            runId: run.id,
            nodeRunId: nodeRun.id,
            eventType: 'RUN_WAITING_FOR_APPROVAL',
            metadata: { approval_id: approval.id },
          });
          this.logger.info({ ...context, node_id: node.id }, 'worker.waiting_for_approval');
          return 'WAITING_FOR_APPROVAL';
        }

        value = await this.executeNode(node, value, run.id, nodeRun.id, run.projectId);
        await this.store.updateNodeRun(nodeRun.id, {
          status: 'COMPLETED',
          output: value,
          completedAt: new Date().toISOString(),
        });
        await this.store.addTrace({
          runId: run.id,
          nodeRunId: nodeRun.id,
          eventType: 'NODE_COMPLETED',
          metadata: { node_id: node.id, node_type: node.type },
        });
        this.logger.info({ ...context, node_id: node.id }, 'worker.node_completed');
        active = null;
        nodeId = await this.nextNode(version.graph, node, value, run.id);
      }
      await this.store.updateRun(run.id, {
        status: 'COMPLETED',
        output: value,
        completedAt: new Date().toISOString(),
      });
      await this.store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: 'RUN_COMPLETED',
        metadata: {},
      });
      this.logger.info(context, 'worker.run_completed');
      return 'COMPLETED';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow execution failed.';
      if (error instanceof TransientAiError || error instanceof TransientExecutionError) {
        if (active)
          await this.store.updateNodeRun(active.id, {
            status: 'PENDING',
            errorCode: 'TRANSIENT_FAILURE',
            errorMessage: message,
          });
        throw new TransientExecutionError(message);
      }
      if (active) {
        await this.store.updateNodeRun(active.id, {
          status: 'FAILED',
          errorCode: 'NODE_EXECUTION_FAILED',
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
        await this.store.addTrace({
          runId: run.id,
          nodeRunId: active.id,
          eventType: 'NODE_FAILED',
          metadata: { node_id: active.node.id, node_type: active.node.type, message },
        });
      }
      return this.failRun(run.id, 'EXECUTION_FAILED', message, context);
    }
  }

  private async executeNode(
    node: Exclude<WorkflowNode, { type: 'HUMAN_APPROVAL' }>,
    input: Record<string, unknown>,
    runId: string,
    nodeRunId: string,
    projectId: string,
  ): Promise<Record<string, unknown>> {
    switch (node.type) {
      case 'INPUT':
        if (typeof input.input !== 'string' || !input.input.trim())
          throw new Error('Runtime input.input must be a non-empty string.');
        return { input: input.input };
      case 'RETRIEVAL': {
        const query = readPath(input, node.config.query_path);
        if (typeof query !== 'string' || !query.trim())
          throw new Error(`RETRIEVAL query path ${node.config.query_path} must resolve to text.`);
        if (!this.embeddings) throw new Error('Embedding service is unavailable.');
        const source = await this.store.getKnowledgeSource(
          projectId,
          node.config.knowledge_source_id,
        );
        if (!source) throw new Error('KnowledgeSource is unavailable in this workflow project.');
        if (!source.embeddingDimensions)
          throw new Error('KnowledgeSource has no ready embeddings.');
        const started = Date.now();
        const traceBase = {
          knowledge_source_id: source.id,
          query_length: query.length,
          top_k: node.config.top_k,
          embedding_provider: source.embeddingProvider,
          embedding_model: source.embeddingModel,
        };
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'RETRIEVAL_STARTED',
          metadata: traceBase,
        });
        this.logger.info(
          { project_id: projectId, run_id: runId, node_id: node.id, ...traceBase },
          'retrieval.started',
        );
        try {
          const embedded = await this.embeddings.embedQuery({
            query: query.trim(),
            provider: source.embeddingProvider,
            model: source.embeddingModel,
          });
          if (
            embedded.provider !== source.embeddingProvider ||
            embedded.model !== source.embeddingModel ||
            embedded.dimensions !== source.embeddingDimensions
          )
            throw new Error('Query embedding is incompatible with the KnowledgeSource.');
          const queryEmbedding = embedded.vectors[0];
          if (!queryEmbedding) throw new Error('Embedding provider returned no query vector.');
          const records = await this.store.searchKnowledgeChunks({
            projectId,
            sourceId: source.id,
            provider: embedded.provider,
            model: embedded.model,
            dimensions: embedded.dimensions,
            queryEmbedding,
            topK: node.config.top_k,
            ...(node.config.document_id ? { documentId: node.config.document_id } : {}),
          });
          const results = rankRetrievalResults(records);
          const sourceMetadata = results.map((result) => ({
            rank: result.rank,
            chunk_id: result.chunk_id,
            document_id: result.document_id,
            page_number: result.page_number,
            filename: result.source.filename,
            score: result.score,
            score_type: result.score_type,
          }));
          const latencyMs = Date.now() - started;
          await this.store.addTrace({
            runId,
            nodeRunId,
            eventType: 'RETRIEVAL_COMPLETED',
            metadata: {
              ...traceBase,
              result_count: results.length,
              latency_ms: latencyMs,
              results: sourceMetadata,
            },
          });
          this.logger.info(
            {
              project_id: projectId,
              run_id: runId,
              node_id: node.id,
              result_count: results.length,
              latency_ms: latencyMs,
            },
            'retrieval.completed',
          );
          return {
            ...input,
            query: query.trim(),
            retrieval_results: results,
            retrieved_chunk_ids: results.map((result) => result.chunk_id),
            retrieval_context: renderRetrievalContext(results),
          };
        } catch (error) {
          await this.store.addTrace({
            runId,
            nodeRunId,
            eventType: 'RETRIEVAL_FAILED',
            metadata: {
              ...traceBase,
              latency_ms: Date.now() - started,
              reason: error instanceof Error ? error.message : 'Retrieval failed.',
            },
          });
          this.logger.error(
            { project_id: projectId, run_id: runId, node_id: node.id },
            'retrieval.failed',
          );
          if (error instanceof TransientEmbeddingError)
            throw new TransientExecutionError(error.message);
          throw error;
        }
      }
      case 'PROMPT': {
        if (typeof input.input !== 'string') throw new Error('PROMPT requires string input.');
        const promptVersion =
          'prompt_version_id' in node.config
            ? await this.store.getPromptVersionById(projectId, node.config.prompt_version_id)
            : null;
        if ('prompt_version_id' in node.config && !promptVersion)
          throw new Error('Referenced PromptVersion is unavailable in this project.');
        const template = 'template' in node.config ? node.config.template : promptVersion?.template;
        if (!template) throw new Error('PROMPT requires a template or PromptVersion.');
        const values: Record<string, string> = { input: input.input };
        if (typeof input.retrieval_context === 'string')
          values.retrieval_context = input.retrieval_context;
        const prompt = renderPrompt(template, values);
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'PROMPT_RENDERED',
          metadata:
            typeof input.retrieval_context === 'string'
              ? {
                  grounded: true,
                  prompt_length: prompt.length,
                  prompt_version_id: promptVersion?.id ?? null,
                }
              : { prompt, prompt_version_id: promptVersion?.id ?? null },
        });
        return { ...input, prompt };
      }
      case 'LLM': {
        if (typeof input.prompt !== 'string') throw new Error('LLM requires a rendered prompt.');
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'MODEL_REQUEST_STARTED',
          metadata: { model: node.config.model },
        });
        const response: GenerateResponse = await this.aiClient.generate({
          run_id: runId,
          node_id: node.id,
          prompt: input.prompt,
          model: node.config.model,
          temperature: node.config.temperature,
        });
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'MODEL_REQUEST_COMPLETED',
          metadata: {
            provider: response.provider,
            model: response.model,
            latency_ms: response.latency_ms,
            input_tokens: response.input_tokens,
            output_tokens: response.output_tokens,
          },
        });
        const retrieved = Array.isArray(input.retrieval_results)
          ? (input.retrieval_results as RankedRetrievalResult[])
          : [];
        let citedChunkIds: string[] = [];
        if (retrieved.length) {
          const validation = validateCitations(response.text, retrieved);
          if (validation.invalidReferences.length) {
            await this.store.addTrace({
              runId,
              nodeRunId,
              eventType: 'CITATION_VALIDATION_FAILED',
              metadata: { invalid_references: validation.invalidReferences },
            });
            this.logger.error({ run_id: runId, node_id: node.id }, 'citation.validation_failed');
            throw new Error(
              `Model cited sources that were not retrieved: ${validation.invalidReferences.join(', ')}.`,
            );
          }
          citedChunkIds = validation.citedChunkIds;
          const sourceMetadata = retrieved.map((result) => ({
            chunk_id: result.chunk_id,
            document_id: result.document_id,
            page_number: result.page_number,
            filename: result.source.filename,
          }));
          await this.store.createCitationValidation({
            runId,
            nodeRunId,
            retrievedChunkIds: retrieved.map((result) => result.chunk_id),
            citedChunkIds,
            sourceMetadata,
          });
          await this.store.addTrace({
            runId,
            nodeRunId,
            eventType: 'CITATIONS_VALIDATED',
            metadata: {
              retrieved_chunk_ids: retrieved.map((result) => result.chunk_id),
              cited_chunk_ids: citedChunkIds,
              sources: sourceMetadata,
            },
          });
        }
        return {
          ...input,
          text: response.text,
          provider: response.provider,
          model: response.model,
          latency_ms: response.latency_ms,
          input_tokens: response.input_tokens,
          output_tokens: response.output_tokens,
          ...(retrieved.length ? { citations: citedChunkIds } : {}),
        };
      }
      case 'CONDITION': {
        const result = evaluateCondition(
          input,
          node.config.path,
          node.config.operator,
          node.config.value,
        );
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'CONDITION_EVALUATED',
          metadata: {
            node_id: node.id,
            path: node.config.path,
            operator: node.config.operator,
            condition_result: result,
          },
        });
        return { ...input, condition_result: result };
      }
      case 'TRANSFORM': {
        const output = renderStructuredValue(node.config.output, input);
        if (!output || typeof output !== 'object' || Array.isArray(output))
          throw new Error('TRANSFORM output must be an object.');
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'TRANSFORM_COMPLETED',
          metadata: { node_id: node.id, output_fields: Object.keys(output) },
        });
        return output as Record<string, unknown>;
      }
      case 'HTTP_REQUEST': {
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'HTTP_REQUEST_STARTED',
          metadata: {
            node_id: node.id,
            method: node.config.method,
            host: new URL(node.config.url).host,
          },
        });
        try {
          const output = await executeHttpRequest(node, {
            projectId,
            runId,
            nodeId: node.id,
            input,
            secrets: this.toolSecrets,
          });
          await this.store.addTrace({
            runId,
            nodeRunId,
            eventType: 'HTTP_REQUEST_COMPLETED',
            metadata: {
              node_id: node.id,
              method: node.config.method,
              host: new URL(node.config.url).host,
              status: output.status,
              latency_ms: output.latency_ms,
            },
          });
          return output;
        } catch (error) {
          const blocked = error instanceof HttpToolBlockedError;
          await this.store.addTrace({
            runId,
            nodeRunId,
            eventType: blocked ? 'HTTP_REQUEST_BLOCKED' : 'HTTP_REQUEST_FAILED',
            metadata: {
              node_id: node.id,
              method: node.config.method,
              host: new URL(node.config.url).host,
              reason: error instanceof Error ? error.message : 'HTTP request failed.',
            },
          });
          if (error instanceof HttpToolTransientError)
            throw new TransientExecutionError(error.message);
          throw error;
        }
      }
      case 'OUTPUT':
        if (typeof input.text !== 'string') throw new Error('OUTPUT requires model text.');
        return {
          text: input.text,
          ...(Array.isArray(input.citations) ? { citations: input.citations } : {}),
          ...(Array.isArray(input.retrieval_results)
            ? { retrieval_results: input.retrieval_results }
            : {}),
        };
    }
  }

  private async nextNode(
    graph: WorkflowGraph,
    node: WorkflowNode,
    value: Record<string, unknown>,
    runId: string,
  ): Promise<string | undefined> {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    if (node.type !== 'CONDITION') return outgoing[0]?.target;
    const selectedBranch = value.condition_result === true ? 'true' : 'false';
    const selected = outgoing.find((edge) => edge.branch === selectedBranch);
    const rejected = outgoing.find((edge) => edge.branch !== selectedBranch);
    if (!selected || !rejected) throw new Error('CONDITION branch topology is invalid.');
    await this.store.addTrace({
      runId,
      nodeRunId: null,
      eventType: 'BRANCH_SELECTED',
      metadata: { condition_node_id: node.id, selected_branch: selectedBranch },
    });
    await this.skipBranch(graph, rejected.target, runId, node.id, selectedBranch);
    return selected.target;
  }

  private async skipBranch(
    graph: WorkflowGraph,
    startId: string,
    runId: string,
    conditionNodeId: string,
    selectedBranch: 'true' | 'false',
  ): Promise<void> {
    const pending = [startId];
    const visited = new Set<string>();
    while (pending.length) {
      const nodeId = pending.shift();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) continue;
      const nodeRun = await this.store.createNodeRun({
        runId,
        nodeId: node.id,
        nodeType: node.type,
      });
      if (!['COMPLETED', 'SKIPPED'].includes(nodeRun.status)) {
        await this.store.updateNodeRun(nodeRun.id, {
          status: 'SKIPPED',
          errorCode: 'CONDITION_BRANCH_NOT_SELECTED',
          errorMessage: `Branch ${selectedBranch === 'true' ? 'false' : 'true'} was not selected.`,
          completedAt: new Date().toISOString(),
        });
        await this.store.addTrace({
          runId,
          nodeRunId: nodeRun.id,
          eventType: 'NODE_SKIPPED',
          metadata: {
            node_id: node.id,
            reason: 'CONDITION_BRANCH_NOT_SELECTED',
            condition_node_id: conditionNodeId,
            selected_branch: selectedBranch,
          },
        });
      }
      pending.push(
        ...graph.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target),
      );
    }
  }
  private async failRun(
    runId: string,
    code: string,
    message: string,
    context: Record<string, unknown>,
  ): Promise<'FAILED'> {
    await this.store.updateRun(runId, {
      status: 'FAILED',
      errorCode: code,
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });
    await this.store.addTrace({
      runId,
      nodeRunId: null,
      eventType: 'RUN_FAILED',
      metadata: { code, message },
    });
    this.logger.error(context, 'worker.run_failed');
    return 'FAILED';
  }
  private async cancelRun(
    runId: string,
    reason: string,
    context: Record<string, unknown>,
  ): Promise<'CANCELLED'> {
    await this.store.updateRun(runId, {
      status: 'CANCELLED',
      errorCode: 'RUN_CANCELLED',
      errorMessage: reason,
      completedAt: new Date().toISOString(),
    });
    await this.store.addTrace({
      runId,
      nodeRunId: null,
      eventType: 'RUN_CANCELLED',
      metadata: { reason },
    });
    this.logger.info(context, 'worker.run_cancelled');
    return 'CANCELLED';
  }
}
