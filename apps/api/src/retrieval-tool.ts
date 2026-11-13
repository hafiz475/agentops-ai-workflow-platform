import type { EmbeddingServiceClient } from './ai-client.js';
import type { RunLogger } from './executor.js';
import { rankRetrievalResults, renderRetrievalContext } from './retrieval.js';
import type { Store } from './store.js';

export const executeRetrieval = async (input: {
  knowledgeSourceId: string;
  query: string;
  topK: number;
  documentId?: string;
  projectId: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  store: Store;
  embeddings: EmbeddingServiceClient;
  logger: RunLogger;
}): Promise<Record<string, unknown>> => {
  const source = await input.store.getKnowledgeSource(input.projectId, input.knowledgeSourceId);
  if (!source) throw new Error('KnowledgeSource is unavailable in this workflow project.');
  if (!source.embeddingDimensions) throw new Error('KnowledgeSource has no ready embeddings.');
  const started = Date.now();
  const traceBase = {
    knowledge_source_id: source.id,
    query_length: input.query.length,
    top_k: input.topK,
    embedding_provider: source.embeddingProvider,
    embedding_model: source.embeddingModel,
  };
  await input.store.addTrace({
    runId: input.runId,
    nodeRunId: input.nodeRunId,
    eventType: 'RETRIEVAL_STARTED',
    metadata: traceBase,
  });
  input.logger.info(
    { project_id: input.projectId, run_id: input.runId, node_id: input.nodeId, ...traceBase },
    'retrieval.started',
  );
  try {
    const embedded = await input.embeddings.embedQuery({
      query: input.query.trim(),
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
    const records = await input.store.searchKnowledgeChunks({
      projectId: input.projectId,
      sourceId: source.id,
      provider: embedded.provider,
      model: embedded.model,
      dimensions: embedded.dimensions,
      queryEmbedding,
      topK: input.topK,
      ...(input.documentId ? { documentId: input.documentId } : {}),
    });
    const results = rankRetrievalResults(records);
    const latencyMs = Date.now() - started;
    await input.store.addTrace({
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      eventType: 'RETRIEVAL_COMPLETED',
      metadata: {
        ...traceBase,
        result_count: results.length,
        latency_ms: latencyMs,
        results: results.map((result) => ({
          rank: result.rank,
          chunk_id: result.chunk_id,
          document_id: result.document_id,
          page_number: result.page_number,
          filename: result.source.filename,
          score: result.score,
          score_type: result.score_type,
        })),
      },
    });
    input.logger.info(
      {
        project_id: input.projectId,
        run_id: input.runId,
        node_id: input.nodeId,
        result_count: results.length,
        latency_ms: latencyMs,
      },
      'retrieval.completed',
    );
    return {
      query: input.query.trim(),
      results,
      retrieval_results: results,
      retrieved_chunk_ids: results.map((result) => result.chunk_id),
      retrieval_context: renderRetrievalContext(results),
    };
  } catch (error) {
    await input.store.addTrace({
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      eventType: 'RETRIEVAL_FAILED',
      metadata: {
        ...traceBase,
        latency_ms: Date.now() - started,
        reason: error instanceof Error ? error.message : 'Retrieval failed.',
      },
    });
    input.logger.error(
      { project_id: input.projectId, run_id: input.runId, node_id: input.nodeId },
      'retrieval.failed',
    );
    throw error;
  }
};
