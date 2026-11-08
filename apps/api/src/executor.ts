import type { GenerateResponse, WorkflowNode } from '@agentops/contracts';
import type { AiServiceClient } from './ai-client.js';
import { TransientAiError } from './ai-client.js';
import { renderPrompt, validateWorkflowGraph } from './graph.js';
import type { RunRecord, Store, WorkflowVersionRecord } from './store.js';

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
      startedAt: current.startedAt ?? new Date().toISOString(),
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
      for (const nodeId of validation.executionOrder) {
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
        const prompt = renderPrompt(template, { input: input.input });
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'PROMPT_RENDERED',
          metadata: { prompt, prompt_version_id: promptVersion?.id ?? null },
        });
        return { prompt };
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
        return {
          text: response.text,
          provider: response.provider,
          model: response.model,
          latency_ms: response.latency_ms,
          input_tokens: response.input_tokens,
          output_tokens: response.output_tokens,
        };
      }
      case 'OUTPUT':
        if (typeof input.text !== 'string') throw new Error('OUTPUT requires model text.');
        return { text: input.text };
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
