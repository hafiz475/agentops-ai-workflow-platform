import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { EmbeddingServiceClient } from './ai-client.js';
import type { KnowledgeDocumentRecord, Store } from './store.js';

export const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

interface ExtractedPage {
  pageNumber: number | null;
  text: string;
}

export const extractDocumentPages = async (
  document: Pick<KnowledgeDocumentRecord, 'mimeType' | 'rawContent'>,
): Promise<ExtractedPage[]> => {
  if (document.mimeType === 'text/plain')
    return [{ pageNumber: null, text: document.rawContent.toString('utf8') }];
  if (document.mimeType === 'application/pdf') {
    const pages: ExtractedPage[] = [];
    const loadingTask = getDocument({
      data: new Uint8Array(document.rawContent),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const parsed = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
      const page = await parsed.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      pages.push({ pageNumber, text });
      page.cleanup();
    }
    await parsed.destroy();
    return pages;
  }
  if (
    document.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer: document.rawContent });
    return [{ pageNumber: null, text: result.value }];
  }
  throw new Error('Unsupported document type.');
};

export interface DeterministicChunk {
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  metadata: Record<string, unknown>;
}

export const chunkDocument = (
  pages: ExtractedPage[],
  filename: string,
  maximumCharacters = 1_200,
  overlapCharacters = 200,
): DeterministicChunk[] => {
  const chunks: DeterministicChunk[] = [];
  for (const page of pages) {
    const text = page.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maximumCharacters);
      if (end < text.length) {
        const boundary = text.lastIndexOf(' ', end);
        if (boundary > start + Math.floor(maximumCharacters / 2)) end = boundary;
      }
      const content = text.slice(start, end).trim();
      if (content) {
        chunks.push({
          chunkIndex: chunks.length,
          pageNumber: page.pageNumber,
          content,
          metadata: {
            filename,
            page_number: page.pageNumber,
            character_start: start,
            character_end: end,
          },
        });
      }
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlapCharacters);
    }
  }
  if (!chunks.length) throw new Error('Document contains no extractable text.');
  return chunks;
};

export interface KnowledgeLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export class KnowledgeIngestionProcessor {
  public constructor(
    private readonly store: Store,
    private readonly embeddings: EmbeddingServiceClient,
    private readonly logger: KnowledgeLogger,
  ) {}

  public async process(documentId: string): Promise<'READY'> {
    const document = await this.store.getKnowledgeDocumentById(documentId);
    if (!document) throw new Error(`KnowledgeDocument ${documentId} does not exist.`);
    if (document.status === 'READY') return 'READY';
    const context = {
      project_id: document.projectId,
      knowledge_source_id: document.knowledgeSourceId,
      knowledge_document_id: document.id,
    };
    await this.store.updateKnowledgeDocument(document.id, {
      status: 'PROCESSING',
      errorMessage: null,
    });
    this.logger.info(context, 'knowledge_document.processing');
    try {
      const source = await this.store.getKnowledgeSource(
        document.projectId,
        document.knowledgeSourceId,
      );
      if (!source) throw new Error('KnowledgeSource is unavailable in the document project.');
      const pages = await extractDocumentPages(document);
      const chunks = chunkDocument(pages, document.originalFilename);
      this.logger.info(
        { ...context, chunk_count: chunks.length, embedding_provider: source.embeddingProvider },
        'embedding.started',
      );
      const vectors: number[][] = [];
      let dimensions: number | null = null;
      let provider: string | null = null;
      let model: string | null = null;
      let latencyMs = 0;
      for (let offset = 0; offset < chunks.length; offset += 64) {
        const batch = chunks.slice(offset, offset + 64);
        const result = await this.embeddings.embedTexts({
          texts: batch.map((chunk) => chunk.content),
          provider: source.embeddingProvider,
          model: source.embeddingModel,
        });
        if (
          (dimensions !== null && dimensions !== result.dimensions) ||
          (provider !== null && provider !== result.provider) ||
          (model !== null && model !== result.model)
        )
          throw new Error('Embedding provider changed model or dimensions within one document.');
        dimensions = result.dimensions;
        provider = result.provider;
        model = result.model;
        latencyMs += result.latency_ms;
        vectors.push(...result.vectors);
      }
      if (!dimensions || !provider || !model || vectors.length !== chunks.length)
        throw new Error('Embedding provider returned an incomplete result.');
      await this.store.replaceDocumentChunks({
        document,
        provider,
        model,
        dimensions,
        chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] ?? [] })),
      });
      this.logger.info(
        {
          ...context,
          chunk_count: chunks.length,
          embedding_provider: provider,
          embedding_model: model,
          dimensions,
          latency_ms: latencyMs,
        },
        'embedding.completed',
      );
      return 'READY';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document ingestion failed.';
      await this.store.updateKnowledgeDocument(document.id, {
        status: 'FAILED',
        errorMessage: message,
      });
      this.logger.error(context, 'knowledge_document.failed');
      throw error;
    }
  }
}
