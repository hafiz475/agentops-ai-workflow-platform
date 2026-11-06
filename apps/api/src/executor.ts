import type { GenerateResponse, WorkflowNode } from '@agentops/contracts';
import type { AiServiceClient } from './ai-client.js';
import { renderPrompt, validateWorkflowGraph } from './graph.js';
import type { RunRecord, Store, WorkflowVersionRecord } from './store.js';

export interface RunLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export class RunExecutor {
  public constructor(
    private readonly store: Store,
    private readonly aiClient: AiServiceClient,
    private readonly logger: RunLogger,
  ) {}

  public enqueue(run: RunRecord, version: WorkflowVersionRecord): void {
    setImmediate(() => void this.execute(run, version));
  }

  public async execute(run: RunRecord, version: WorkflowVersionRecord): Promise<void> {
    const context = {
      project_id: run.projectId,
      workflow_id: run.workflowId,
      workflow_version_id: version.id,
      run_id: run.id,
    };
    const validation = validateWorkflowGraph(version.graph);
    if (!validation.valid) {
      await this.failRun(run.id, 'INVALID_VERSION', validation.errors.join(' '), context);
      return;
    }

    await this.store.updateRun(run.id, { status: 'RUNNING', startedAt: new Date().toISOString() });
    await this.store.addTrace({
      runId: run.id,
      nodeRunId: null,
      eventType: 'RUN_STARTED',
      metadata: {},
    });
    this.logger.info(context, 'workflow.run_started');
    let value: Record<string, unknown> = run.input;
    let currentNodeRunId: string | null = null;
    let currentNode: WorkflowNode | null = null;

    try {
      for (const nodeId of validation.executionOrder) {
        const node = version.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`Validated node ${nodeId} is missing.`);
        currentNode = node;
        const nodeRun = await this.store.createNodeRun({
          runId: run.id,
          nodeId: node.id,
          nodeType: node.type,
        });
        currentNodeRunId = nodeRun.id;
        const nodeContext = { ...context, node_id: node.id };
        await this.store.updateNodeRun(nodeRun.id, {
          status: 'RUNNING',
          input: value,
          startedAt: new Date().toISOString(),
        });
        await this.store.addTrace({
          runId: run.id,
          nodeRunId: nodeRun.id,
          eventType: 'NODE_STARTED',
          metadata: { node_id: node.id, node_type: node.type },
        });
        this.logger.info(nodeContext, 'workflow.node_started');
        value = await this.executeNode(node, value, run.id, nodeRun.id);
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
        this.logger.info(nodeContext, 'workflow.node_completed');
        currentNodeRunId = null;
        currentNode = null;
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
      this.logger.info(context, 'workflow.run_completed');
    } catch (error) {
      const safeMessage = error instanceof Error ? error.message : 'Workflow execution failed.';
      if (currentNodeRunId && currentNode) {
        await this.store.updateNodeRun(currentNodeRunId, {
          status: 'FAILED',
          errorCode: 'NODE_EXECUTION_FAILED',
          errorMessage: safeMessage,
          completedAt: new Date().toISOString(),
        });
        await this.store.addTrace({
          runId: run.id,
          nodeRunId: currentNodeRunId,
          eventType: 'NODE_FAILED',
          metadata: { node_id: currentNode.id, node_type: currentNode.type, message: safeMessage },
        });
        this.logger.error({ ...context, node_id: currentNode.id }, 'workflow.node_failed');
      }
      await this.failRun(run.id, 'EXECUTION_FAILED', safeMessage, context);
    }
  }

  private async executeNode(
    node: WorkflowNode,
    input: Record<string, unknown>,
    runId: string,
    nodeRunId: string,
  ): Promise<Record<string, unknown>> {
    switch (node.type) {
      case 'INPUT': {
        if (typeof input.input !== 'string' || input.input.trim() === '')
          throw new Error('Runtime input.input must be a non-empty string.');
        return { input: input.input };
      }
      case 'PROMPT': {
        const value = input.input;
        if (typeof value !== 'string') throw new Error('PROMPT requires string input.');
        const prompt = renderPrompt(node.config.template, { input: value });
        await this.store.addTrace({
          runId,
          nodeRunId,
          eventType: 'PROMPT_RENDERED',
          metadata: { prompt },
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
      case 'OUTPUT': {
        if (typeof input.text !== 'string') throw new Error('OUTPUT requires model text.');
        return { text: input.text };
      }
    }
  }

  private async failRun(
    runId: string,
    code: string,
    message: string,
    context: Record<string, unknown>,
  ): Promise<void> {
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
    this.logger.error(context, 'workflow.run_failed');
  }
}
