import { createHash } from 'node:crypto';
import path from 'node:path';
import type { WorkflowGraph } from '@agentops/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_DOCUMENT_MIME_TYPES } from './knowledge.js';
import type { DurableQueue } from './queue.js';
import type { KnowledgeDocumentRecord, Store } from './store.js';

const idParams = z.object({ projectId: z.string().uuid() });
const sourceParams = idParams.extend({ sourceId: z.string().uuid() });
const documentParams = sourceParams.extend({ documentId: z.string().uuid() });

const sourceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).nullable().optional(),
    type: z.literal('DOCUMENTS').default('DOCUMENTS'),
    embeddingProvider: z.enum(['development', 'openai']).default('development'),
    embeddingModel: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const validationError = (error: z.ZodError): { error: string; details: string[] } => ({
  error: 'INVALID_REQUEST',
  details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
});

const publicDocument = (document: KnowledgeDocumentRecord) => {
  const { rawContent, ...safe } = document;
  void rawContent;
  return safe;
};

export const validateKnowledgeSourceReferences = async (
  store: Store,
  projectId: string,
  graph: WorkflowGraph,
): Promise<string[]> => {
  const errors: string[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'RETRIEVAL') continue;
    const source = await store.getKnowledgeSource(projectId, node.config.knowledge_source_id);
    if (!source) {
      errors.push(
        `RETRIEVAL node ${node.id} references a KnowledgeSource unavailable in this project.`,
      );
      continue;
    }
    if (node.config.document_id) {
      const document = await store.getKnowledgeDocument(
        projectId,
        source.id,
        node.config.document_id,
      );
      if (!document)
        errors.push(
          `RETRIEVAL node ${node.id} references a document unavailable in this project/source.`,
        );
    }
  }
  return errors;
};

export const registerKnowledgeRoutes = async (
  app: FastifyInstance,
  store: Store,
  queue: DurableQueue,
): Promise<void> => {
  app.post('/api/v1/projects/:projectId/knowledge-sources', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = sourceBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const source = await store.createKnowledgeSource(params.data.projectId, {
      name: body.data.name,
      description: body.data.description ?? null,
      embeddingProvider: body.data.embeddingProvider,
      embeddingModel:
        body.data.embeddingModel ??
        (body.data.embeddingProvider === 'development'
          ? 'development-hash-v1'
          : 'text-embedding-3-small'),
    });
    if (!source) return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    app.log.info(
      { project_id: source.projectId, knowledge_source_id: source.id },
      'knowledge_source.created',
    );
    return reply.code(201).send(source);
  });

  app.get('/api/v1/projects/:projectId/knowledge-sources', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    return store.listKnowledgeSources(params.data.projectId);
  });

  app.get('/api/v1/projects/:projectId/knowledge-sources/:sourceId', async (request, reply) => {
    const params = sourceParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const source = await store.getKnowledgeSource(params.data.projectId, params.data.sourceId);
    return source ?? reply.code(404).send({ error: 'KNOWLEDGE_SOURCE_NOT_FOUND' });
  });

  app.post(
    '/api/v1/projects/:projectId/knowledge-sources/:sourceId/documents',
    async (request, reply) => {
      const params = sourceParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      if (!(await store.getKnowledgeSource(params.data.projectId, params.data.sourceId)))
        return reply.code(404).send({ error: 'KNOWLEDGE_SOURCE_NOT_FOUND' });
      let upload;
      try {
        upload = await request.file({ limits: { files: 1, fileSize: 5_242_880 } });
      } catch {
        return reply.code(413).send({ error: 'DOCUMENT_TOO_LARGE' });
      }
      if (!upload) return reply.code(400).send({ error: 'DOCUMENT_REQUIRED' });
      if (!SUPPORTED_DOCUMENT_MIME_TYPES.has(upload.mimetype))
        return reply.code(415).send({ error: 'UNSUPPORTED_DOCUMENT_TYPE' });
      const filename = path.basename(upload.filename).slice(0, 255);
      if (!filename) return reply.code(400).send({ error: 'INVALID_FILENAME' });
      const content = await upload.toBuffer();
      if (!content.length) return reply.code(400).send({ error: 'EMPTY_DOCUMENT' });
      const created = await store.createKnowledgeDocument({
        projectId: params.data.projectId,
        knowledgeSourceId: params.data.sourceId,
        originalFilename: filename,
        mimeType: upload.mimetype,
        fileSize: content.length,
        sha256Hash: createHash('sha256').update(content).digest('hex'),
        rawContent: content,
      });
      if (!created) return reply.code(404).send({ error: 'KNOWLEDGE_SOURCE_NOT_FOUND' });
      if (created.created || created.document.status === 'FAILED') {
        if (!created.created)
          await store.updateKnowledgeDocument(created.document.id, {
            status: 'UPLOADED',
            errorMessage: null,
          });
        await queue.enqueueKnowledgeIngestion(created.document.id);
      }
      app.log.info(
        {
          project_id: params.data.projectId,
          knowledge_source_id: params.data.sourceId,
          knowledge_document_id: created.document.id,
          duplicate: !created.created,
        },
        'knowledge_document.uploaded',
      );
      return reply.code(created.created ? 202 : 200).send(publicDocument(created.document));
    },
  );

  app.get(
    '/api/v1/projects/:projectId/knowledge-sources/:sourceId/documents',
    async (request, reply) => {
      const params = sourceParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      if (!(await store.getKnowledgeSource(params.data.projectId, params.data.sourceId)))
        return reply.code(404).send({ error: 'KNOWLEDGE_SOURCE_NOT_FOUND' });
      return (await store.listKnowledgeDocuments(params.data.projectId, params.data.sourceId)).map(
        publicDocument,
      );
    },
  );

  app.get(
    '/api/v1/projects/:projectId/knowledge-sources/:sourceId/documents/:documentId',
    async (request, reply) => {
      const params = documentParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      const document = await store.getKnowledgeDocument(
        params.data.projectId,
        params.data.sourceId,
        params.data.documentId,
      );
      return document
        ? publicDocument(document)
        : reply.code(404).send({ error: 'KNOWLEDGE_DOCUMENT_NOT_FOUND' });
    },
  );

  app.get(
    '/api/v1/projects/:projectId/knowledge-sources/:sourceId/chunks',
    async (request, reply) => {
      const params = sourceParams.safeParse(request.params);
      const query = z.object({ documentId: z.string().uuid().optional() }).safeParse(request.query);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      if (!query.success) return reply.code(400).send(validationError(query.error));
      if (!(await store.getKnowledgeSource(params.data.projectId, params.data.sourceId)))
        return reply.code(404).send({ error: 'KNOWLEDGE_SOURCE_NOT_FOUND' });
      return store.listKnowledgeChunks(
        params.data.projectId,
        params.data.sourceId,
        query.data.documentId,
      );
    },
  );
};
