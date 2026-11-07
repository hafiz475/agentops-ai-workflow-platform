import type {
  WorkflowVersionRecord,
  EvaluationCaseRecord,
  EvaluationRunRecord,
  Store,
} from './store.js';
import { evaluateOutput } from './evaluators.js';
import type { RunExecutor, RunLogger } from './executor.js';

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
};

export class EvaluationExecutor {
  public constructor(
    private readonly store: Store,
    private readonly runExecutor: RunExecutor,
    private readonly logger: RunLogger,
  ) {}

  public enqueue(
    evaluationRun: EvaluationRunRecord,
    cases: EvaluationCaseRecord[],
    version: WorkflowVersionRecord,
  ): void {
    setImmediate(() => void this.execute(evaluationRun, cases, version));
  }

  public async execute(
    evaluationRun: EvaluationRunRecord,
    cases: EvaluationCaseRecord[],
    version: WorkflowVersionRecord,
  ): Promise<void> {
    const context = {
      project_id: evaluationRun.projectId,
      evaluation_run_id: evaluationRun.id,
      dataset_id: evaluationRun.datasetId,
      workflow_id: evaluationRun.workflowId,
      workflow_version_id: evaluationRun.workflowVersionId,
    };
    try {
      await this.store.updateEvaluationRun(evaluationRun.id, {
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
      });
      this.logger.info(context, 'evaluation.started');
      const scores: number[] = [];
      const latencies: number[] = [];
      let passedCases = 0;
      let failedCases = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      for (const evaluationCase of cases) {
        const result = await this.store.createEvaluationCaseResult({
          evaluationRunId: evaluationRun.id,
          evaluationCaseId: evaluationCase.id,
        });
        const caseContext = {
          ...context,
          evaluation_case_id: evaluationCase.id,
          evaluation_case_result_id: result.id,
        };
        this.logger.info(caseContext, 'evaluation.case_started');
        const started = Date.now();
        let workflowRunId: string | null = null;
        try {
          const workflowRun = await this.store.createRun({
            projectId: evaluationRun.projectId,
            workflowId: evaluationRun.workflowId,
            workflowVersionId: version.id,
            runtimeInput: evaluationCase.input,
          });
          workflowRunId = workflowRun.id;
          await this.store.updateEvaluationCaseResult(result.id, { workflowRunId });
          await this.store.addTrace({
            runId: workflowRun.id,
            nodeRunId: null,
            eventType: 'RUN_CREATED',
            metadata: {
              evaluation_run_id: evaluationRun.id,
              evaluation_case_id: evaluationCase.id,
            },
          });
          await this.runExecutor.execute(workflowRun, version);
          const completed = await this.store.getRun(
            evaluationRun.projectId,
            evaluationRun.workflowId,
            workflowRun.id,
          );
          const nodeRuns = await this.store.listNodeRuns(workflowRun.id);
          const llmOutput = nodeRuns.find((node) => node.nodeType === 'LLM')?.output ?? null;
          const latencyMs =
            completed?.startedAt && completed.completedAt
              ? Math.max(
                  0,
                  new Date(completed.completedAt).getTime() -
                    new Date(completed.startedAt).getTime(),
                )
              : Date.now() - started;
          const caseInputTokens =
            typeof llmOutput?.input_tokens === 'number' ? llmOutput.input_tokens : 0;
          const caseOutputTokens =
            typeof llmOutput?.output_tokens === 'number' ? llmOutput.output_tokens : 0;
          latencies.push(latencyMs);
          inputTokens += caseInputTokens;
          outputTokens += caseOutputTokens;
          if (!completed || completed.status !== 'COMPLETED' || !completed.output) {
            throw new Error(completed?.errorMessage ?? 'Workflow execution did not complete.');
          }
          const outcome = evaluateOutput(
            evaluationCase.evaluatorConfig,
            evaluationCase.expectedOutput,
            completed.output,
          );
          scores.push(outcome.score);
          if (outcome.passed) passedCases += 1;
          else failedCases += 1;
          await this.store.updateEvaluationCaseResult(result.id, {
            status: 'COMPLETED',
            actualOutput: completed.output,
            score: outcome.score,
            passed: outcome.passed,
            latencyMs,
            inputTokens: caseInputTokens,
            outputTokens: caseOutputTokens,
          });
          this.logger.info(
            {
              ...caseContext,
              workflow_run_id: workflowRun.id,
              passed: outcome.passed,
              score: outcome.score,
            },
            'evaluation.case_completed',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Evaluation case failed.';
          scores.push(0);
          failedCases += 1;
          await this.store.updateEvaluationCaseResult(result.id, {
            workflowRunId,
            status: 'FAILED',
            score: 0,
            passed: false,
            latencyMs: Date.now() - started,
            inputTokens: 0,
            outputTokens: 0,
            errorCode: 'EVALUATION_CASE_FAILED',
            errorMessage: message,
          });
          this.logger.error(
            { ...caseContext, workflow_run_id: workflowRunId },
            'evaluation.case_failed',
          );
        }
      }

      await this.store.updateEvaluationRun(evaluationRun.id, {
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        totalCases: cases.length,
        passedCases,
        failedCases,
        averageScore: scores.length
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : 0,
        averageLatencyMs: latencies.length
          ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
          : 0,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      });
      this.logger.info(
        { ...context, passed_cases: passedCases, failed_cases: failedCases },
        'evaluation.completed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evaluation execution failed.';
      await this.store.updateEvaluationRun(evaluationRun.id, {
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        errorCode: 'EVALUATION_FAILED',
        errorMessage: message,
      });
      this.logger.error(context, 'evaluation.failed');
    }
  }
}
