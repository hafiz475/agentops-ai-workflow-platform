import { workflowGraphSchema } from '@agentops/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RunExecutor } from './executor.js';
import { validateWorkflowGraph } from './graph.js';
import type { Store } from './store.js';

const idParams = z.object({ projectId: z.string().uuid() });
const workflowParams = idParams.extend({ workflowId: z.string().uuid() });
const versionParams = workflowParams.extend({ versionId: z.string().uuid() });
const runParams = workflowParams.extend({ runId: z.string().uuid() });
const projectBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});
const workflowBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  graph: workflowGraphSchema.nullable().optional(),
});
const runBody = z.object({
  workflowVersionId: z.string().uuid().optional(),
  input: z.object({ input: z.string().trim().min(1) }),
});

const validationError = (error: z.ZodError): { error: string; details: string[] } => ({
  error: 'INVALID_REQUEST',
  details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
});

export const registerApiRoutes = async (
  app: FastifyInstance,
  store: Store,
  executor: RunExecutor,
): Promise<void> => {
  app.post('/api/v1/projects', async (request, reply) => {
    const parsed = projectBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const project = await store.createProject({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    });
    return reply.code(201).send(project);
  });
  app.get('/api/v1/projects', async () => store.listProjects());
  app.get('/api/v1/projects/:projectId', async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const project = await store.getProject(parsed.data.projectId);
    return project ?? reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
  });

  app.post('/api/v1/projects/:projectId/workflows', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = workflowBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const workflow = await store.createWorkflow(params.data.projectId, {
      name: body.data.name,
      description: body.data.description ?? null,
      draftGraph: body.data.graph ?? null,
    });
    return workflow
      ? reply.code(201).send(workflow)
      : reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
  });
  app.get('/api/v1/projects/:projectId/workflows', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    return store.listWorkflows(params.data.projectId);
  });
  app.get('/api/v1/projects/:projectId/workflows/:workflowId', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const workflow = await store.getWorkflow(params.data.projectId, params.data.workflowId);
    return workflow ?? reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
  });
  app.patch('/api/v1/projects/:projectId/workflows/:workflowId', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    const body = workflowBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const workflow = await store.updateWorkflow(params.data.projectId, params.data.workflowId, {
      name: body.data.name,
      description: body.data.description ?? null,
      draftGraph: body.data.graph ?? null,
    });
    return workflow ?? reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
  });
  app.post('/api/v1/projects/:projectId/workflows/:workflowId/validate', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    const graph = workflowGraphSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getWorkflow(params.data.projectId, params.data.workflowId)))
      return reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
    if (!graph.success) return reply.code(422).send(validationError(graph.error));
    const result = validateWorkflowGraph(graph.data);
    return reply.code(result.valid ? 200 : 422).send(result);
  });

  app.post('/api/v1/projects/:projectId/workflows/:workflowId/versions', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const workflow = await store.getWorkflow(params.data.projectId, params.data.workflowId);
    if (!workflow) return reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
    const candidate =
      request.body && typeof request.body === 'object' && 'graph' in request.body
        ? (request.body as { graph?: unknown }).graph
        : workflow.draftGraph;
    const graph = workflowGraphSchema.safeParse(candidate);
    if (!graph.success) return reply.code(422).send(validationError(graph.error));
    const result = validateWorkflowGraph(graph.data);
    if (!result.valid)
      return reply.code(422).send({ error: 'INVALID_WORKFLOW_GRAPH', details: result.errors });
    const version = await store.createVersion(
      params.data.projectId,
      params.data.workflowId,
      graph.data,
    );
    return version
      ? reply.code(201).send(version)
      : reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
  });
  app.get('/api/v1/projects/:projectId/workflows/:workflowId/versions', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getWorkflow(params.data.projectId, params.data.workflowId)))
      return reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
    return store.listVersions(params.data.projectId, params.data.workflowId);
  });
  app.get(
    '/api/v1/projects/:projectId/workflows/:workflowId/versions/:versionId',
    async (request, reply) => {
      const params = versionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      const version = await store.getVersion(
        params.data.projectId,
        params.data.workflowId,
        params.data.versionId,
      );
      return version ?? reply.code(404).send({ error: 'WORKFLOW_VERSION_NOT_FOUND' });
    },
  );

  app.post('/api/v1/projects/:projectId/workflows/:workflowId/runs', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    const body = runBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const version = body.data.workflowVersionId
      ? await store.getVersion(
          params.data.projectId,
          params.data.workflowId,
          body.data.workflowVersionId,
        )
      : await store.getLatestVersion(params.data.projectId, params.data.workflowId);
    if (!version) return reply.code(422).send({ error: 'WORKFLOW_VERSION_REQUIRED' });
    const validation = validateWorkflowGraph(version.graph);
    if (!validation.valid)
      return reply.code(422).send({ error: 'INVALID_WORKFLOW_GRAPH', details: validation.errors });
    const run = await store.createRun({
      projectId: params.data.projectId,
      workflowId: params.data.workflowId,
      workflowVersionId: version.id,
      runtimeInput: body.data.input,
    });
    await store.addTrace({
      runId: run.id,
      nodeRunId: null,
      eventType: 'RUN_CREATED',
      metadata: {},
    });
    app.log.info(
      {
        project_id: run.projectId,
        workflow_id: run.workflowId,
        workflow_version_id: version.id,
        run_id: run.id,
      },
      'workflow.run_created',
    );
    executor.enqueue(run, version);
    return reply.code(202).send(run);
  });
  app.get('/api/v1/projects/:projectId/workflows/:workflowId/runs', async (request, reply) => {
    const params = workflowParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getWorkflow(params.data.projectId, params.data.workflowId)))
      return reply.code(404).send({ error: 'WORKFLOW_NOT_FOUND' });
    return store.listRuns(params.data.projectId, params.data.workflowId);
  });
  app.get(
    '/api/v1/projects/:projectId/workflows/:workflowId/runs/:runId',
    async (request, reply) => {
      const params = runParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      const run = await store.getRun(
        params.data.projectId,
        params.data.workflowId,
        params.data.runId,
      );
      if (!run) return reply.code(404).send({ error: 'RUN_NOT_FOUND' });
      return { ...run, nodeRuns: await store.listNodeRuns(run.id) };
    },
  );
  app.get(
    '/api/v1/projects/:projectId/workflows/:workflowId/runs/:runId/trace',
    async (request, reply) => {
      const params = runParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      const trace = await store.listTrace(
        params.data.projectId,
        params.data.workflowId,
        params.data.runId,
      );
      return trace ?? reply.code(404).send({ error: 'RUN_NOT_FOUND' });
    },
  );
};
