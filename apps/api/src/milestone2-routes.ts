import { evaluatorConfigSchema, type WorkflowGraph } from '@agentops/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DurableQueue } from './queue.js';
import { validateEvaluator } from './evaluators.js';
import { validatePromptTemplate, validateWorkflowGraph } from './graph.js';
import type { EvaluationRunRecord, Store } from './store.js';

const projectParams = z.object({ projectId: z.string().uuid() });
const promptParams = projectParams.extend({ promptId: z.string().uuid() });
const promptVersionParams = promptParams.extend({ versionId: z.string().uuid() });
const datasetParams = projectParams.extend({ datasetId: z.string().uuid() });
const evaluationRunParams = projectParams.extend({ runId: z.string().uuid() });
const promptBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});
const promptVersionBody = z.object({
  template: z.string().trim().min(1).max(20_000),
  variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).optional(),
  changeNotes: z.string().trim().max(2000).nullable().optional(),
});
const datasetBody = promptBody;
const caseBody = z.object({
  input: z.record(z.string(), z.unknown()),
  expectedOutput: z.record(z.string(), z.unknown()),
  evaluatorConfig: evaluatorConfigSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const evaluationRunBody = z.object({
  datasetId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
});
const comparisonBody = z.object({
  evaluationRunIdA: z.string().uuid(),
  evaluationRunIdB: z.string().uuid(),
});
const validationError = (error: z.ZodError) => ({
  error: 'INVALID_REQUEST',
  details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
});
const passPercentage = (run: EvaluationRunRecord): number =>
  run.totalCases === 0 ? 0 : (run.passedCases / run.totalCases) * 100;
const promptVersionIds = (graph: WorkflowGraph): string[] =>
  graph.nodes
    .filter((node) => node.type === 'PROMPT' && 'prompt_version_id' in node.config)
    .map((node) =>
      node.type === 'PROMPT' && 'prompt_version_id' in node.config
        ? node.config.prompt_version_id
        : '',
    )
    .filter(Boolean);

export const validatePromptVersionReferences = async (
  store: Store,
  projectId: string,
  graph: WorkflowGraph,
): Promise<string[]> => {
  const ids = promptVersionIds(graph);
  const resolved = await Promise.all(ids.map((id) => store.getPromptVersionById(projectId, id)));
  return ids
    .filter((_id, index) => !resolved[index])
    .map((id) => `PromptVersion ${id} is unavailable in project ${projectId}.`);
};

export const registerMilestone2Routes = async (
  app: FastifyInstance,
  store: Store,
  queue: DurableQueue,
): Promise<void> => {
  app.post('/api/v1/projects/:projectId/prompts', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    const body = promptBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const prompt = await store.createPrompt(params.data.projectId, {
      name: body.data.name,
      description: body.data.description ?? null,
    });
    if (!prompt) return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    app.log.info({ project_id: params.data.projectId, prompt_id: prompt.id }, 'prompt.created');
    return reply.code(201).send(prompt);
  });
  app.get('/api/v1/projects/:projectId/prompts', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    const prompts = await store.listPrompts(params.data.projectId);
    return Promise.all(
      prompts.map(async (prompt) => ({
        ...prompt,
        versions: await store.listPromptVersions(params.data.projectId, prompt.id),
      })),
    );
  });
  app.get('/api/v1/projects/:projectId/prompts/:promptId', async (request, reply) => {
    const params = promptParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const prompt = await store.getPrompt(params.data.projectId, params.data.promptId);
    return prompt
      ? {
          ...prompt,
          versions: await store.listPromptVersions(params.data.projectId, params.data.promptId),
        }
      : reply.code(404).send({ error: 'PROMPT_NOT_FOUND' });
  });
  app.post('/api/v1/projects/:projectId/prompts/:promptId/versions', async (request, reply) => {
    const params = promptParams.safeParse(request.params);
    const body = promptVersionBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const templateValidation = validatePromptTemplate(body.data.template);
    if (!templateValidation.valid)
      return reply
        .code(422)
        .send({ error: 'INVALID_PROMPT_TEMPLATE', details: templateValidation.errors });
    if (
      body.data.variables &&
      JSON.stringify([...body.data.variables].sort()) !==
        JSON.stringify(templateValidation.variables)
    )
      return reply.code(422).send({
        error: 'PROMPT_VARIABLE_MISMATCH',
        details: ['Declared variables must exactly match controlled placeholders.'],
      });
    const version = await store.createPromptVersion(params.data.projectId, params.data.promptId, {
      template: body.data.template,
      variables: templateValidation.variables,
      changeNotes: body.data.changeNotes ?? null,
    });
    if (!version) return reply.code(404).send({ error: 'PROMPT_NOT_FOUND' });
    app.log.info(
      {
        project_id: params.data.projectId,
        prompt_id: params.data.promptId,
        prompt_version_id: version.id,
      },
      'prompt.version_created',
    );
    return reply.code(201).send(version);
  });
  app.get('/api/v1/projects/:projectId/prompts/:promptId/versions', async (request, reply) => {
    const params = promptParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getPrompt(params.data.projectId, params.data.promptId)))
      return reply.code(404).send({ error: 'PROMPT_NOT_FOUND' });
    return store.listPromptVersions(params.data.projectId, params.data.promptId);
  });
  app.get(
    '/api/v1/projects/:projectId/prompts/:promptId/versions/:versionId',
    async (request, reply) => {
      const params = promptVersionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      return (
        (await store.getPromptVersion(
          params.data.projectId,
          params.data.promptId,
          params.data.versionId,
        )) ?? reply.code(404).send({ error: 'PROMPT_VERSION_NOT_FOUND' })
      );
    },
  );

  app.post('/api/v1/projects/:projectId/evaluation-datasets', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    const body = datasetBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const dataset = await store.createEvaluationDataset(params.data.projectId, {
      name: body.data.name,
      description: body.data.description ?? null,
    });
    return dataset
      ? reply.code(201).send(dataset)
      : reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
  });
  app.get('/api/v1/projects/:projectId/evaluation-datasets', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    const datasets = await store.listEvaluationDatasets(params.data.projectId);
    return Promise.all(
      datasets.map(async (dataset) => ({
        ...dataset,
        cases: await store.listEvaluationCases(params.data.projectId, dataset.id),
      })),
    );
  });
  app.get('/api/v1/projects/:projectId/evaluation-datasets/:datasetId', async (request, reply) => {
    const params = datasetParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const dataset = await store.getEvaluationDataset(params.data.projectId, params.data.datasetId);
    return dataset
      ? {
          ...dataset,
          cases: await store.listEvaluationCases(params.data.projectId, params.data.datasetId),
        }
      : reply.code(404).send({ error: 'EVALUATION_DATASET_NOT_FOUND' });
  });
  app.post(
    '/api/v1/projects/:projectId/evaluation-datasets/:datasetId/cases',
    async (request, reply) => {
      const params = datasetParams.safeParse(request.params);
      const body = caseBody.safeParse(request.body);
      if (!params.success) return reply.code(400).send(validationError(params.error));
      if (!body.success) return reply.code(400).send(validationError(body.error));
      const evaluatorErrors = validateEvaluator(body.data.evaluatorConfig);
      if (evaluatorErrors.length)
        return reply.code(422).send({ error: 'INVALID_EVALUATOR', details: evaluatorErrors });
      const evaluationCase = await store.createEvaluationCase(
        params.data.projectId,
        params.data.datasetId,
        {
          input: body.data.input,
          expectedOutput: body.data.expectedOutput,
          evaluatorConfig: body.data.evaluatorConfig,
          metadata: body.data.metadata ?? {},
        },
      );
      return evaluationCase
        ? reply.code(201).send(evaluationCase)
        : reply.code(404).send({ error: 'EVALUATION_DATASET_NOT_FOUND' });
    },
  );

  app.post('/api/v1/projects/:projectId/evaluation-runs', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    const body = evaluationRunBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const dataset = await store.getEvaluationDataset(params.data.projectId, body.data.datasetId);
    const workflow = await store.getWorkflow(params.data.projectId, body.data.workflowId);
    const version = await store.getVersion(
      params.data.projectId,
      body.data.workflowId,
      body.data.workflowVersionId,
    );
    if (!dataset) return reply.code(404).send({ error: 'EVALUATION_DATASET_NOT_FOUND' });
    if (!workflow || !version) return reply.code(404).send({ error: 'WORKFLOW_VERSION_NOT_FOUND' });
    const graphValidation = validateWorkflowGraph(version.graph);
    const promptErrors = await validatePromptVersionReferences(
      store,
      params.data.projectId,
      version.graph,
    );
    if (!graphValidation.valid || promptErrors.length)
      return reply.code(422).send({
        error: 'INVALID_WORKFLOW_VERSION',
        details: [...graphValidation.errors, ...promptErrors],
      });
    const cases = await store.listEvaluationCases(params.data.projectId, dataset.id);
    if (!cases.length) return reply.code(422).send({ error: 'EVALUATION_DATASET_EMPTY' });
    const run = await store.createEvaluationRun({
      projectId: params.data.projectId,
      datasetId: dataset.id,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      totalCases: cases.length,
    });
    app.log.info(
      {
        project_id: params.data.projectId,
        evaluation_run_id: run.id,
        dataset_id: dataset.id,
        workflow_version_id: version.id,
      },
      'evaluation.created',
    );
    try {
      await queue.enqueueEvaluation(run.id);
    } catch {
      await store.updateEvaluationRun(run.id, {
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        errorCode: 'QUEUE_UNAVAILABLE',
        errorMessage: 'Evaluation could not be queued.',
      });
      return reply.code(503).send({ error: 'QUEUE_UNAVAILABLE', evaluationRunId: run.id });
    }
    return reply.code(202).send(run);
  });
  app.get('/api/v1/projects/:projectId/evaluation-runs', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!(await store.getProject(params.data.projectId)))
      return reply.code(404).send({ error: 'PROJECT_NOT_FOUND' });
    return store.listEvaluationRuns(params.data.projectId);
  });
  app.get('/api/v1/projects/:projectId/evaluation-runs/:runId', async (request, reply) => {
    const params = evaluationRunParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    const run = await store.getEvaluationRun(params.data.projectId, params.data.runId);
    if (!run) return reply.code(404).send({ error: 'EVALUATION_RUN_NOT_FOUND' });
    const results = await store.listEvaluationCaseResults(params.data.projectId, run.id);
    const cases = await store.listEvaluationCases(params.data.projectId, run.datasetId);
    const byId = new Map(cases.map((item) => [item.id, item]));
    return {
      ...run,
      passPercentage: passPercentage(run),
      results: (results ?? []).map((result) => ({
        ...result,
        evaluationCase: byId.get(result.evaluationCaseId) ?? null,
      })),
    };
  });
  app.post('/api/v1/projects/:projectId/evaluation-comparisons', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    const body = comparisonBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationError(params.error));
    if (!body.success) return reply.code(400).send(validationError(body.error));
    const [a, b] = await Promise.all([
      store.getEvaluationRun(params.data.projectId, body.data.evaluationRunIdA),
      store.getEvaluationRun(params.data.projectId, body.data.evaluationRunIdB),
    ]);
    if (!a || !b) return reply.code(404).send({ error: 'EVALUATION_RUN_NOT_FOUND' });
    if (a.status !== 'COMPLETED' || b.status !== 'COMPLETED')
      return reply.code(422).send({ error: 'EVALUATION_RUN_NOT_COMPLETED' });
    if (a.datasetId !== b.datasetId)
      return reply.code(422).send({
        error: 'INCOMPATIBLE_EVALUATION_RUNS',
        details: ['Runs must use the same EvaluationDataset.'],
      });
    const [versionA, versionB] = await Promise.all([
      store.getVersion(params.data.projectId, a.workflowId, a.workflowVersionId),
      store.getVersion(params.data.projectId, b.workflowId, b.workflowVersionId),
    ]);
    if (!versionA || !versionB)
      return reply.code(422).send({ error: 'WORKFLOW_VERSION_NOT_FOUND' });
    const summary = (run: EvaluationRunRecord, ids: string[]) => ({
      evaluationRunId: run.id,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      promptVersionIds: ids,
      passPercentage: passPercentage(run),
      averageScore: run.averageScore ?? 0,
      averageLatencyMs: run.averageLatencyMs ?? 0,
      totalTokens: run.totalTokens,
    });
    const sa = summary(a, promptVersionIds(versionA.graph));
    const sb = summary(b, promptVersionIds(versionB.graph));
    return {
      datasetId: a.datasetId,
      runA: sa,
      runB: sb,
      deltas: {
        qualityScore: sb.averageScore - sa.averageScore,
        passPercentagePoints: sb.passPercentage - sa.passPercentage,
        latencyMs: sb.averageLatencyMs - sa.averageLatencyMs,
        totalTokens: sb.totalTokens - sa.totalTokens,
      },
      interpretation:
        'Positive quality and pass-rate deltas favor Run B; negative latency and token deltas favor Run B.',
    };
  });
};
