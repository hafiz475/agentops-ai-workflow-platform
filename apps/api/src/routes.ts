import { workflowGraphSchema } from '@agentops/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DurableQueue } from './queue.js';
import { validateWorkflowGraph } from './graph.js';
import type { Store } from './store.js';
import { validatePromptVersionReferences } from './milestone2-routes.js';

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
  queue: DurableQueue,
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
    const promptErrors = await validatePromptVersionReferences(
      store,
      params.data.projectId,
      graph.data,
    );
    const response = {
      ...result,
      valid: result.valid && promptErrors.length === 0,
      errors: [...result.errors, ...promptErrors],
    };
    return reply.code(response.valid ? 200 : 422).send(response);
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
    const promptErrors = await validatePromptVersionReferences(
      store,
      params.data.projectId,
      graph.data,
    );
    if (!result.valid || promptErrors.length)
      return reply
        .code(422)
        .send({ error: 'INVALID_WORKFLOW_GRAPH', details: [...result.errors, ...promptErrors] });
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
    try {
      const jobId = await queue.enqueueRun(run.id);
      await store.updateRun(run.id, { queueJobId: jobId });
      await store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: 'RUN_QUEUED',
        metadata: { job_id: jobId },
      });
      return reply.code(202).send({ ...run, queueJobId: jobId });
    } catch {
      await store.updateRun(run.id, {
        status: 'FAILED',
        errorCode: 'QUEUE_UNAVAILABLE',
        errorMessage: 'Run could not be queued.',
        completedAt: new Date().toISOString(),
      });
      await store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: 'RUN_FAILED',
        metadata: { code: 'QUEUE_UNAVAILABLE' },
      });
      return reply.code(503).send({ error: 'QUEUE_UNAVAILABLE', runId: run.id });
    }
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
  app.post(
    '/api/v1/projects/:projectId/workflows/:workflowId/runs/:runId/cancel',
    async (request, reply) => {
      const params = runParams.safeParse(request.params);
      const body = z
        .object({ reason: z.string().max(500).optional() })
        .safeParse(request.body ?? {});
      if (!params.success) return reply.code(400).send(validationError(params.error));
      if (!body.success) return reply.code(400).send(validationError(body.error));
      const run = await store.getRun(
        params.data.projectId,
        params.data.workflowId,
        params.data.runId,
      );
      if (!run) return reply.code(404).send({ error: 'RUN_NOT_FOUND' });
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return reply.send(run);
      const reason = body.data.reason ?? 'Cancelled by user.';
      const terminal = run.status !== 'RUNNING';
      await store.updateRun(run.id, {
        status: terminal ? 'CANCELLED' : 'RUNNING',
        cancellationRequestedAt: new Date().toISOString(),
        cancellationReason: reason,
        completedAt: terminal ? new Date().toISOString() : null,
      });
      await store.addTrace({
        runId: run.id,
        nodeRunId: null,
        eventType: 'RUN_CANCEL_REQUESTED',
        metadata: { reason },
      });
      if (terminal) {
        if (run.queueJobId) await queue.removeRun(run.queueJobId);
        const approval = (await store.listApprovals(run.projectId)).find(
          (item) => item.runId === run.id && item.status === 'PENDING',
        );
        if (approval) {
          await store.decideApproval(run.projectId, approval.id, 'CANCELLED', reason);
          await store.updateNodeRun(approval.nodeRunId, {
            status: 'CANCELLED',
            completedAt: new Date().toISOString(),
          });
        }
        await store.addTrace({
          runId: run.id,
          nodeRunId: null,
          eventType: 'RUN_CANCELLED',
          metadata: { reason },
        });
      }
      return reply.send(await store.getRun(params.data.projectId, params.data.workflowId, run.id));
    },
  );

  app.get('/api/v1/projects/:projectId/approvals', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    const approvals = await store.listApprovals(params.data.projectId);
    return Promise.all(
      approvals.map(async (approval) => ({
        ...approval,
        run: await store.getRunById(approval.runId),
      })),
    );
  });
  app.get('/api/v1/projects/:projectId/approvals/:approvalId', async (request, reply) => {
    const params = idParams.extend({ approvalId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const approval = await store.getApproval(params.data.projectId, params.data.approvalId);
    if (!approval) return reply.code(404).send({ error: 'APPROVAL_NOT_FOUND' });
    const run = await store.getRunById(approval.runId);
    return { ...approval, run, nodeRuns: run ? await store.listNodeRuns(run.id) : [] };
  });
  for (const decision of ['approve', 'reject'] as const) {
    app.post(
      `/api/v1/projects/:projectId/approvals/:approvalId/${decision}`,
      async (request, reply) => {
        const params = idParams.extend({ approvalId: z.string().uuid() }).safeParse(request.params);
        const body = z
          .object({ reason: z.string().max(1000).optional() })
          .safeParse(request.body ?? {});
        if (!params.success) return reply.code(400).send(validationError(params.error));
        if (!body.success) return reply.code(400).send(validationError(body.error));
        const current = await store.getApproval(params.data.projectId, params.data.approvalId);
        if (!current) return reply.code(404).send({ error: 'APPROVAL_NOT_FOUND' });
        if (current.status !== 'PENDING')
          return reply.code(409).send({ error: 'APPROVAL_ALREADY_DECIDED', approval: current });
        const run = await store.getRunById(current.runId);
        if (!run || run.status === 'CANCELLED')
          return reply.code(409).send({ error: 'RUN_NOT_APPROVABLE' });
        const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
        const approval = await store.decideApproval(
          params.data.projectId,
          current.id,
          status,
          body.data.reason ?? null,
        );
        if (!approval) return reply.code(409).send({ error: 'APPROVAL_ALREADY_DECIDED' });
        await store.addTrace({
          runId: run.id,
          nodeRunId: current.nodeRunId,
          eventType: decision === 'approve' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
          metadata: { approval_id: approval.id, reason: approval.reason },
        });
        if (decision === 'reject') {
          await store.updateNodeRun(current.nodeRunId, {
            status: 'CANCELLED',
            completedAt: new Date().toISOString(),
          });
          await store.updateRun(run.id, {
            status: 'CANCELLED',
            errorCode: 'HUMAN_REJECTED',
            errorMessage: approval.reason ?? 'Human reviewer rejected the run.',
            completedAt: new Date().toISOString(),
          });
          await store.addTrace({
            runId: run.id,
            nodeRunId: null,
            eventType: 'RUN_CANCELLED',
            metadata: { reason: 'HUMAN_REJECTED' },
          });
        } else {
          try {
            const jobId = await queue.enqueueRun(run.id, approval.id);
            await store.updateRun(run.id, { status: 'QUEUED', queueJobId: jobId });
            await store.addTrace({
              runId: run.id,
              nodeRunId: null,
              eventType: 'RUN_QUEUED',
              metadata: { job_id: jobId, resume: true },
            });
          } catch {
            await store.updateRun(run.id, {
              status: 'FAILED',
              errorCode: 'QUEUE_UNAVAILABLE',
              errorMessage: 'Approved run could not be resumed.',
              completedAt: new Date().toISOString(),
            });
            await store.addTrace({
              runId: run.id,
              nodeRunId: null,
              eventType: 'RUN_FAILED',
              metadata: { code: 'QUEUE_UNAVAILABLE' },
            });
            return reply.code(503).send({ error: 'QUEUE_UNAVAILABLE', runId: run.id });
          }
        }
        return reply.send(approval);
      },
    );
  }
};
