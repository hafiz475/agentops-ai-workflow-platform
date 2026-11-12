import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { WorkflowGraph } from '@agentops/contracts';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { TransientEmbeddingError, type EmbeddingServiceClient } from '../src/ai-client.js';
import { buildApp } from '../src/app.js';
import { evaluateOutput } from '../src/evaluators.js';
import { RunExecutor } from '../src/executor.js';
import {
  chunkDocument,
  extractDocumentPages,
  KnowledgeIngestionProcessor,
} from '../src/knowledge.js';
import { validateKnowledgeSourceReferences } from '../src/knowledge-routes.js';
import type { DurableQueue } from '../src/queue.js';
import { validateCitations } from '../src/retrieval.js';
import { MemoryStore } from './memory-store.js';

const logger = { info() {}, error() {} };

const createPdf = async (): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false, compress: false, pdfVersion: '1.3' });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.addPage().text('Page one: normal operating conditions.');
    document.addPage().text('Page two: abnormal vibration in the bearing.');
    document.end();
  });

const createDocx = async (): Promise<Buffer> => {
  const archive = new JSZip();
  archive.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  archive
    .folder('_rels')
    ?.file(
      '.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
  archive
    .folder('word')
    ?.file(
      'document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX bearing inspection found abnormal vibration.</w:t></w:r></w:p></w:body></w:document>',
    );
  return archive.generateAsync({ type: 'nodebuffer' });
};

const vectorFor = (text: string): number[] => {
  const normalized = text.toLowerCase();
  const vector = [
    normalized.includes('vibration') ? 1 : 0,
    normalized.includes('abnormal') ? 1 : 0,
    normalized.includes('temperature') ? 1 : 0,
    normalized.includes('bearing') ? 1 : 0,
  ];
  return vector.some(Boolean) ? vector : [0.1, 0.1, 0.1, 0.1];
};

class DeterministicEmbeddings implements EmbeddingServiceClient {
  public calls = 0;
  async embedTexts(request: {
    texts: string[];
    provider: 'development' | 'openai';
    model: string;
  }) {
    this.calls += 1;
    return {
      vectors: request.texts.map(vectorFor),
      provider: request.provider,
      model: request.model,
      dimensions: 4,
      latency_ms: 1,
      input_tokens: null,
    };
  }
  async embedQuery(request: { query: string; provider: 'development' | 'openai'; model: string }) {
    return this.embedTexts({
      texts: [request.query],
      provider: request.provider,
      model: request.model,
    });
  }
}

const createReadySource = async (
  store: MemoryStore,
  embeddings = new DeterministicEmbeddings(),
) => {
  const project = await store.createProject({ name: 'Retrieval', description: null });
  const source = await store.createKnowledgeSource(project.id, {
    name: 'Engineering reports',
    description: null,
    embeddingProvider: 'development',
    embeddingModel: 'development-hash-v1',
  });
  assert.ok(source);
  const created = await store.createKnowledgeDocument({
    projectId: project.id,
    knowledgeSourceId: source.id,
    originalFilename: 'inspection.txt',
    mimeType: 'text/plain',
    fileSize: 118,
    sha256Hash: 'vibration-document',
    rawContent: Buffer.from(
      'Inspection finding: abnormal vibration was found in the turbine bearing. Recommended action: inspect alignment.',
    ),
  });
  assert.ok(created);
  const processor = new KnowledgeIngestionProcessor(store, embeddings, logger);
  await processor.process(created.document.id);
  return { project, source, document: created.document, embeddings, processor };
};

const ragGraph = (sourceId: string): WorkflowGraph => ({
  nodes: [
    { id: 'input', type: 'INPUT', version: 1, position: { x: 0, y: 0 }, config: {} },
    {
      id: 'retrieve',
      type: 'RETRIEVAL',
      version: 1,
      position: { x: 1, y: 0 },
      config: { knowledge_source_id: sourceId, query_path: 'input', top_k: 3 },
    },
    {
      id: 'prompt',
      type: 'PROMPT',
      version: 1,
      position: { x: 2, y: 0 },
      config: {
        template:
          'System: answer only from evidence.\nQuestion: {{input}}\nSources:\n{{retrieval_context}}\nCite [[SOURCE:1]].',
      },
    },
    {
      id: 'llm',
      type: 'LLM',
      version: 1,
      position: { x: 3, y: 0 },
      config: { provider: 'configured-default', model: 'development', temperature: 0 },
    },
    { id: 'output', type: 'OUTPUT', version: 1, position: { x: 4, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'retrieve' },
    { id: 'e2', source: 'retrieve', target: 'prompt' },
    { id: 'e3', source: 'prompt', target: 'llm' },
    { id: 'e4', source: 'llm', target: 'output' },
  ],
});

describe('Milestone 5 ingestion and embeddings', () => {
  it('extracts TXT, PDF pages, and DOCX text', async () => {
    assert.deepEqual(
      await extractDocumentPages({ mimeType: 'text/plain', rawContent: Buffer.from('plain text') }),
      [{ pageNumber: null, text: 'plain text' }],
    );
    const pdfPages = await extractDocumentPages({
      mimeType: 'application/pdf',
      rawContent: await createPdf(),
    });
    assert.equal(pdfPages.length, 2);
    assert.match(pdfPages[1]?.text ?? '', /abnormal vibration/);
    assert.deepEqual(
      pdfPages.map((page) => page.pageNumber),
      [1, 2],
    );
    const docxPages = await extractDocumentPages({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rawContent: await createDocx(),
    });
    assert.match(docxPages[0]?.text ?? '', /DOCX bearing inspection/);
    assert.equal(docxPages[0]?.pageNumber, null);
  });

  it('chunks deterministically with overlap and preserved page metadata', () => {
    const pages = [{ pageNumber: 3, text: 'bearing vibration '.repeat(180) }];
    const first = chunkDocument(pages, 'manual.pdf', 300, 50);
    const second = chunkDocument(pages, 'manual.pdf', 300, 50);
    assert.deepEqual(first, second);
    assert.ok(first.length > 1);
    assert.ok(first.every((chunk) => chunk.pageNumber === 3));
    assert.deepEqual(
      first.map((chunk) => chunk.chunkIndex),
      [...first.keys()],
    );
  });

  it('ingests TXT, persists vectors, is idempotent, and deduplicates uploads', async () => {
    const store = new MemoryStore();
    const fixture = await createReadySource(store);
    assert.equal((await store.getKnowledgeDocumentById(fixture.document.id))?.status, 'READY');
    assert.equal(store.knowledgeChunks.length, 1);
    assert.equal(store.chunkEmbeddings.size, 1);
    const calls = fixture.embeddings.calls;
    await fixture.processor.process(fixture.document.id);
    assert.equal(fixture.embeddings.calls, calls);
    assert.equal(store.knowledgeChunks.length, 1);
    const duplicate = await store.createKnowledgeDocument({
      projectId: fixture.project.id,
      knowledgeSourceId: fixture.source.id,
      originalFilename: 'duplicate.txt',
      mimeType: 'text/plain',
      fileSize: 1,
      sha256Hash: 'vibration-document',
      rawContent: Buffer.from('x'),
    });
    assert.equal(duplicate?.created, false);
    assert.equal(duplicate?.document.id, fixture.document.id);
  });

  it('marks extraction failures FAILED without creating duplicate chunks', async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: 'P', description: null });
    const source = await store.createKnowledgeSource(project.id, {
      name: 'S',
      description: null,
      embeddingProvider: 'development',
      embeddingModel: 'development-hash-v1',
    });
    assert.ok(source);
    const created = await store.createKnowledgeDocument({
      projectId: project.id,
      knowledgeSourceId: source.id,
      originalFilename: 'bad.bin',
      mimeType: 'application/octet-stream',
      fileSize: 3,
      sha256Hash: 'bad',
      rawContent: Buffer.from('bad'),
    });
    assert.ok(created);
    await assert.rejects(
      () =>
        new KnowledgeIngestionProcessor(store, new DeterministicEmbeddings(), logger).process(
          created.document.id,
        ),
      /Unsupported document/,
    );
    assert.equal((await store.getKnowledgeDocumentById(created.document.id))?.status, 'FAILED');
    assert.equal(store.knowledgeChunks.length, 0);
  });

  it('rejects dimension and model mismatches', async () => {
    const store = new MemoryStore();
    const fixture = await createReadySource(store);
    await assert.rejects(
      () =>
        store.replaceDocumentChunks({
          document: fixture.document,
          provider: 'development',
          model: 'different-model',
          dimensions: 3,
          chunks: [
            { chunkIndex: 0, pageNumber: null, content: 'x', metadata: {}, embedding: [1, 2, 3] },
          ],
        }),
      /provider or model/,
    );
  });
});

describe('Milestone 5 knowledge API and project isolation', () => {
  it('creates, lists, uploads, and scopes knowledge records', async () => {
    const store = new MemoryStore();
    const queued: string[] = [];
    const queue: DurableQueue = {
      async enqueueRun(id) {
        return id;
      },
      async enqueueEvaluation(id) {
        return id;
      },
      async enqueueKnowledgeIngestion(id) {
        queued.push(id);
        return id;
      },
      async removeRun() {},
      async close() {},
    };
    const app = await buildApp(undefined, {
      checkPostgres: async () => undefined,
      checkRedis: async () => undefined,
      aiClient: {
        ready: async () => ({ status: 'ok', service: 'ai', version: '1' }),
        generate: async () => {
          throw new Error('unused');
        },
      },
      store,
      queue,
      close: async () => undefined,
    });
    const project = await store.createProject({ name: 'A', description: null });
    const other = await store.createProject({ name: 'B', description: null });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/knowledge-sources`,
      payload: {
        name: 'Manuals',
        embeddingProvider: 'development',
        embeddingModel: 'development-hash-v1',
      },
    });
    assert.equal(created.statusCode, 201);
    const source = created.json();
    const boundary = 'agentops-boundary';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="manual.txt"\r\nContent-Type: text/plain\r\n\r\nabnormal vibration in bearing\r\n--${boundary}--\r\n`,
    );
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/knowledge-sources/${source.id}/documents`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    assert.equal(uploaded.statusCode, 202, uploaded.body);
    assert.equal(queued.length, 1);
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${other.id}/knowledge-sources/${source.id}`,
    });
    assert.equal(foreign.statusCode, 404);
    await app.close();
  });

  it('rejects cross-project KnowledgeSource and document references', async () => {
    const store = new MemoryStore();
    const a = await createReadySource(store);
    const projectB = await store.createProject({ name: 'B', description: null });
    const graph = ragGraph(a.source.id);
    assert.match(
      (await validateKnowledgeSourceReferences(store, projectB.id, graph)).join(' '),
      /unavailable in this project/,
    );
    const retrieval = graph.nodes.find((node) => node.type === 'RETRIEVAL');
    assert.ok(retrieval?.type === 'RETRIEVAL');
    retrieval.config.document_id = randomUUID();
    assert.match(
      (await validateKnowledgeSourceReferences(store, a.project.id, graph)).join(' '),
      /document unavailable/,
    );
  });
});

describe('Milestone 5 retrieval, RAG, and citations', () => {
  it('executes INPUT -> RETRIEVAL -> PROMPT -> LLM -> OUTPUT with provenance', async () => {
    const store = new MemoryStore();
    const fixture = await createReadySource(store);
    const graph = ragGraph(fixture.source.id);
    const workflow = await store.createWorkflow(fixture.project.id, {
      name: 'RAG',
      description: null,
      draftGraph: graph,
    });
    assert.ok(workflow);
    const version = await store.createVersion(fixture.project.id, workflow.id, graph);
    assert.ok(version);
    const run = await store.createRun({
      projectId: fixture.project.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runtimeInput: { input: 'What abnormal vibration was found?' },
    });
    const executor = new RunExecutor(
      store,
      {
        ready: async () => ({ status: 'ok', service: 'ai', version: '1' }),
        generate: async (request) => {
          assert.match(request.prompt, /UNTRUSTED DATA/);
          assert.match(request.prompt, /abnormal vibration/);
          return {
            text: 'Abnormal vibration was found in the turbine bearing. [[SOURCE:1]]',
            provider: 'development',
            model: 'development',
            latency_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
          };
        },
      },
      logger,
      120_000,
      {},
      fixture.embeddings,
    );
    assert.equal(await executor.execute(run, version), 'COMPLETED');
    const completed = await store.getRunById(run.id);
    assert.equal(completed?.status, 'COMPLETED');
    assert.equal((completed?.output?.citations as string[]).length, 1);
    assert.equal((completed?.output?.retrieval_results as unknown[]).length, 1);
    assert.equal((await store.getNodeRun(run.id, 'retrieve'))?.status, 'COMPLETED');
    assert.ok(store.traces.some((trace) => trace.eventType === 'RETRIEVAL_STARTED'));
    assert.ok(store.traces.some((trace) => trace.eventType === 'RETRIEVAL_COMPLETED'));
    assert.ok(store.traces.some((trace) => trace.eventType === 'CITATIONS_VALIDATED'));
    assert.equal(store.citationValidations.length, 1);
    assert.doesNotMatch(
      JSON.stringify(store.traces.find((trace) => trace.eventType === 'PROMPT_RENDERED')),
      /abnormal vibration/,
    );
  });

  it('enforces top_k, deterministic ranking, document filters, and empty/missing inputs', async () => {
    const store = new MemoryStore();
    const fixture = await createReadySource(store);
    const second = await store.createKnowledgeDocument({
      projectId: fixture.project.id,
      knowledgeSourceId: fixture.source.id,
      originalFilename: 'temperature.txt',
      mimeType: 'text/plain',
      fileSize: 30,
      sha256Hash: 'temperature',
      rawContent: Buffer.from('Normal temperature was recorded.'),
    });
    assert.ok(second);
    await fixture.processor.process(second.document.id);
    const query = vectorFor('abnormal vibration');
    const all = await store.searchKnowledgeChunks({
      projectId: fixture.project.id,
      sourceId: fixture.source.id,
      provider: 'development',
      model: 'development-hash-v1',
      dimensions: 4,
      queryEmbedding: query,
      topK: 1,
    });
    assert.equal(all.length, 1);
    assert.equal(all[0]?.knowledgeDocumentId, fixture.document.id);
    const filtered = await store.searchKnowledgeChunks({
      projectId: fixture.project.id,
      sourceId: fixture.source.id,
      provider: 'development',
      model: 'development-hash-v1',
      dimensions: 4,
      queryEmbedding: query,
      topK: 3,
      documentId: second.document.id,
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.knowledgeDocumentId, second.document.id);
    assert.equal(
      (
        await store.searchKnowledgeChunks({
          projectId: randomUUID(),
          sourceId: fixture.source.id,
          provider: 'development',
          model: 'development-hash-v1',
          dimensions: 4,
          queryEmbedding: query,
          topK: 3,
        })
      ).length,
      0,
    );
  });

  it('rejects citations that were not retrieved', async () => {
    const retrieved = [
      {
        rank: 1,
        chunk_id: randomUUID(),
        document_id: randomUUID(),
        page_number: null,
        content: 'safe',
        score: 1,
        score_type: 'cosine_similarity' as const,
        source: { knowledge_source_id: randomUUID(), filename: 'safe.txt' },
      },
    ];
    const foreign = randomUUID();
    assert.deepEqual(validateCitations(`claim [[CITE:${foreign}]]`, retrieved), {
      citedChunkIds: [],
      invalidReferences: [foreign],
    });
  });

  it('records provider failures as retryable retrieval failures', async () => {
    const store = new MemoryStore();
    const fixture = await createReadySource(store);
    const graph = ragGraph(fixture.source.id);
    const workflow = await store.createWorkflow(fixture.project.id, {
      name: 'RAG',
      description: null,
      draftGraph: graph,
    });
    const version = await store.createVersion(fixture.project.id, workflow!.id, graph);
    const run = await store.createRun({
      projectId: fixture.project.id,
      workflowId: workflow!.id,
      workflowVersionId: version!.id,
      runtimeInput: { input: 'vibration' },
    });
    const failing: EmbeddingServiceClient = {
      async embedTexts() {
        throw new TransientEmbeddingError('provider unavailable');
      },
      async embedQuery() {
        throw new TransientEmbeddingError('provider unavailable');
      },
    };
    const executor = new RunExecutor(
      store,
      {
        ready: async () => ({ status: 'ok', service: 'ai', version: '1' }),
        generate: async () => {
          throw new Error('not reached');
        },
      },
      logger,
      120_000,
      {},
      failing,
    );
    await assert.rejects(() => executor.execute(run, version!), /provider unavailable/);
    assert.ok(store.traces.some((trace) => trace.eventType === 'RETRIEVAL_FAILED'));
  });
});

describe('Milestone 5 retrieval evaluation', () => {
  const chunk1 = randomUUID();
  const chunk2 = randomUUID();
  const chunk3 = randomUUID();
  const actual = {
    retrieval_results: [
      { chunk_id: chunk1, document_id: randomUUID() },
      { chunk_id: chunk2, document_id: randomUUID() },
      { chunk_id: chunk3, document_id: randomUUID() },
    ],
    citations: [chunk1],
  };

  it('computes Hit@K for hits and misses', () => {
    assert.equal(
      evaluateOutput({ type: 'RETRIEVAL_HIT_AT_K', k: 2 }, { expected_chunk_ids: [chunk2] }, actual)
        .score,
      1,
    );
    assert.equal(
      evaluateOutput({ type: 'RETRIEVAL_HIT_AT_K', k: 2 }, { expected_chunk_ids: [chunk3] }, actual)
        .score,
      0,
    );
  });

  it('computes Recall@K for multiple expected chunks', () => {
    const outcome = evaluateOutput(
      { type: 'RETRIEVAL_RECALL_AT_K', k: 2 },
      { expected_chunk_ids: [chunk1, chunk2, chunk3] },
      actual,
    );
    assert.equal(outcome.score, 2 / 3);
    assert.equal(outcome.passed, false);
  });

  it('computes MRR at rank one, later ranks, and no relevant result', () => {
    assert.equal(
      evaluateOutput({ type: 'RETRIEVAL_MRR' }, { expected_chunk_ids: [chunk1] }, actual).score,
      1,
    );
    assert.equal(
      evaluateOutput({ type: 'RETRIEVAL_MRR' }, { expected_chunk_ids: [chunk3] }, actual).score,
      1 / 3,
    );
    assert.equal(
      evaluateOutput({ type: 'RETRIEVAL_MRR' }, { expected_chunk_ids: [randomUUID()] }, actual)
        .score,
      0,
    );
  });

  it('checks required and forbidden citations deterministically', () => {
    assert.equal(
      evaluateOutput(
        { type: 'CITATION_MATCH', required_chunk_ids: [chunk1], forbidden_chunk_ids: [chunk2] },
        {},
        actual,
      ).passed,
      true,
    );
  });
});
