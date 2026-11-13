import {
  agentActionResponseSchema,
  type AgentObservation,
  type AgentToolName,
} from '@agentops/contracts';
import type { AiServiceClient, EmbeddingServiceClient } from './ai-client.js';
import type { RunLogger } from './executor.js';
import type { Store, ToolCallRecord } from './store.js';
import { ToolRegistry } from './tool-registry.js';

type AgentNode = Extract<import('@agentops/contracts').WorkflowNode, { type: 'AGENT' }>;
export type AgentNodeOutcome =
  { kind: 'COMPLETED'; output: Record<string, unknown> } | { kind: 'WAITING' };
export class AgentExecutor {
  private readonly registry = new ToolRegistry();
  public constructor(
    private store: Store,
    private ai: AiServiceClient,
    private logger: RunLogger,
    private embeddings?: EmbeddingServiceClient,
    private secrets: Record<string, Record<string, string>> = {},
  ) {}
  private async trace(
    runId: string,
    nodeRunId: string,
    eventType: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.store.addTrace({ runId, nodeRunId, eventType, metadata });
    const logName: Record<string, string> = {
      AGENT_STARTED: 'agent.started',
      AGENT_STEP_STARTED: 'agent.step_started',
      TOOL_CALL_PROPOSED: 'agent.tool_selected',
      TOOL_CALL_COMPLETED: 'agent.tool_completed',
      TOOL_CALL_FAILED: 'agent.tool_failed',
      AGENT_WAITING_FOR_APPROVAL: 'agent.waiting_for_approval',
      AGENT_RESUMED: 'agent.resumed',
      AGENT_COMPLETED: 'agent.completed',
      AGENT_CANCELLED: 'agent.cancelled',
      AGENT_LIMIT_REACHED: 'agent.limit_reached',
    };
    const message = logName[eventType];
    if (message) this.logger.info({ run_id: runId, node_run_id: nodeRunId, ...metadata }, message);
  }
  public async execute(
    node: AgentNode,
    input: Record<string, unknown>,
    runId: string,
    nodeRunId: string,
    projectId: string,
  ): Promise<AgentNodeOutcome> {
    const invocationStarted = Date.now();
    let execution = await this.store.createAgentExecution({
      projectId,
      runId,
      nodeRunId,
      model: node.config.model,
      maxSteps: node.config.max_steps,
      maxDurationMs: node.config.max_duration_ms,
      maxToolCalls: node.config.max_tool_calls,
      maxTotalTokens: node.config.max_total_tokens,
    });
    let steps = await this.store.listAgentSteps(execution.id);
    if (!steps.length)
      await this.trace(runId, nodeRunId, 'AGENT_STARTED', {
        agent_execution_id: execution.id,
        model: execution.model,
      });
    const waiting = steps.find((s) => s.status === 'WAITING_FOR_APPROVAL');
    if (waiting) {
      const call = await this.store.getToolCall(waiting.id);
      if (call) {
        const approval = call.approvalRequestId
          ? await this.store.getApproval(projectId, call.approvalRequestId)
          : null;
        if (!approval || approval.status === 'PENDING') return { kind: 'WAITING' };
        await this.store.updateAgentExecution(execution.id, { status: 'RUNNING' });
        if (approval.status === 'REJECTED') {
          const result = { tool: call.toolName, status: 'REJECTED_BY_HUMAN' };
          await this.store.updateToolCall(call.id, {
            status: 'REJECTED',
            result,
            completedAt: new Date().toISOString(),
          });
          await this.store.updateAgentStep(waiting.id, {
            status: 'COMPLETED',
            output: result,
            completedAt: new Date().toISOString(),
          });
          await this.trace(runId, nodeRunId, 'AGENT_RESUMED', {
            decision: 'REJECTED',
            step_number: waiting.stepNumber,
          });
        } else if (approval.status === 'APPROVED') {
          await this.trace(runId, nodeRunId, 'AGENT_RESUMED', {
            decision: 'APPROVED',
            step_number: waiting.stepNumber,
          });
          await this.runTool(call, waiting.id, node, runId, nodeRunId, projectId);
        } else return { kind: 'WAITING' };
      }
    }
    for (;;) {
      const current = await this.store.getRunById(runId);
      if (!current || current.cancellationRequestedAt || current.status === 'CANCELLED') {
        await this.store.updateAgentExecution(execution.id, {
          status: 'CANCELLED',
          completedAt: new Date().toISOString(),
        });
        await this.trace(runId, nodeRunId, 'AGENT_CANCELLED');
        throw new Error('Agent execution was cancelled.');
      }
      steps = await this.store.listAgentSteps(execution.id);
      execution = (await this.store.getAgentExecution(nodeRunId)) ?? execution;
      const elapsed = execution.activeDurationMs + (Date.now() - invocationStarted);
      const limit =
        steps.length >= execution.maxSteps
          ? 'MAX_STEPS'
          : elapsed >= execution.maxDurationMs
            ? 'MAX_DURATION'
            : execution.totalTokens >= execution.maxTotalTokens
              ? 'MAX_TOTAL_TOKENS'
              : null;
      if (limit) {
        const output = {
          text: `Agent stopped: ${limit}.`,
          agent: {
            status: 'LIMIT_REACHED',
            limit_reason: limit,
            steps_used: steps.length,
            tool_calls_used: execution.toolCallsUsed,
            tools_used: steps.map((s) => s.toolName).filter(Boolean),
          },
        };
        await this.store.updateAgentExecution(execution.id, {
          status: 'LIMIT_REACHED',
          limitReason: limit,
          activeDurationMs: elapsed,
          completedAt: new Date().toISOString(),
        });
        await this.trace(runId, nodeRunId, 'AGENT_LIMIT_REACHED', { reason: limit });
        return { kind: 'COMPLETED', output };
      }
      const observations: AgentObservation[] = steps
        .filter((s) => s.actionType === 'TOOL_CALL' && s.status === 'COMPLETED')
        .map((s) => ({
          step_number: s.stepNumber,
          tool_name: s.toolName as AgentToolName,
          status:
            s.output?.status === 'REJECTED_BY_HUMAN'
              ? 'REJECTED_BY_HUMAN'
              : s.output?.status === 'FAILED'
                ? 'FAILED'
                : 'COMPLETED',
          ...(s.output?.status === 'FAILED'
            ? {
                error_code: String(s.output.error_code ?? 'TOOL_FAILED'),
                error_message: String(s.output.error_message ?? 'Tool failed.'),
              }
            : { result: s.output ?? {} }),
        }));
      const stepNumber = steps.length + 1;
      const step = await this.store.createAgentStep({
        agentExecutionId: execution.id,
        stepNumber,
        input: { goal: input.input, observations },
      });
      await this.trace(runId, nodeRunId, 'AGENT_STEP_STARTED', { step_number: stepNumber });
      if (!this.ai.selectAgentAction)
        throw new Error('AI service does not support structured agent actions.');
      const response = agentActionResponseSchema.parse(
        await this.ai.selectAgentAction({
          run_id: runId,
          node_id: node.id,
          goal: typeof input.input === 'string' ? input.input : JSON.stringify(input),
          model: node.config.model,
          step_number: stepNumber,
          allowed_tools: this.registry.definitions(node.config.allowed_tools),
          observations,
          limits: {
            max_steps: execution.maxSteps,
            max_tool_calls: execution.maxToolCalls,
            max_duration_ms: execution.maxDurationMs,
            max_total_tokens: execution.maxTotalTokens,
          },
        }),
      );
      const tokens = (response.input_tokens ?? 0) + (response.output_tokens ?? 0);
      await this.store.updateAgentExecution(execution.id, {
        stepsUsed: stepNumber,
        totalTokens: execution.totalTokens + tokens,
      });
      await this.store.updateAgentStep(step.id, {
        actionType: response.action.type,
        actionSummary: response.action.action_summary,
        inputTokens: response.input_tokens,
        outputTokens: response.output_tokens,
        latencyMs: response.latency_ms,
        ...(response.action.type === 'TOOL_CALL' ? { toolName: response.action.tool_name } : {}),
      });
      await this.trace(runId, nodeRunId, 'AGENT_ACTION_SELECTED', {
        step_number: stepNumber,
        action_type: response.action.type,
        ...(response.action.type === 'TOOL_CALL' ? { tool_name: response.action.tool_name } : {}),
      });
      const postActionDuration = execution.activeDurationMs + (Date.now() - invocationStarted);
      const postActionLimit =
        execution.totalTokens + tokens > execution.maxTotalTokens
          ? 'MAX_TOTAL_TOKENS'
          : postActionDuration >= execution.maxDurationMs
            ? 'MAX_DURATION'
            : null;
      if (postActionLimit) {
        const output = {
          text: `Agent stopped: ${postActionLimit}.`,
          agent: {
            status: 'LIMIT_REACHED',
            limit_reason: postActionLimit,
            steps_used: stepNumber,
            tool_calls_used: execution.toolCallsUsed,
            tools_used: steps.map((item) => item.toolName).filter(Boolean),
          },
        };
        await this.store.updateAgentStep(step.id, {
          status: 'FAILED',
          output: { error_code: postActionLimit },
          completedAt: new Date().toISOString(),
        });
        await this.store.updateAgentExecution(execution.id, {
          status: 'LIMIT_REACHED',
          limitReason: postActionLimit,
          activeDurationMs: postActionDuration,
          completedAt: new Date().toISOString(),
        });
        await this.trace(runId, nodeRunId, 'AGENT_LIMIT_REACHED', {
          reason: postActionLimit,
        });
        return { kind: 'COMPLETED', output };
      }
      if (response.action.type === 'FINAL') {
        const output = {
          ...response.action.output,
          agent: {
            status: 'COMPLETED',
            steps_used: stepNumber,
            tool_calls_used: execution.toolCallsUsed,
            tools_used: steps.map((s) => s.toolName).filter(Boolean),
          },
        };
        await this.store.updateAgentStep(step.id, {
          status: 'COMPLETED',
          output: response.action.output,
          completedAt: new Date().toISOString(),
        });
        await this.store.updateAgentExecution(execution.id, {
          status: 'COMPLETED',
          activeDurationMs: postActionDuration,
          completedAt: new Date().toISOString(),
        });
        await this.trace(runId, nodeRunId, 'AGENT_COMPLETED', { steps_used: stepNumber });
        return { kind: 'COMPLETED', output };
      }
      if (execution.toolCallsUsed >= execution.maxToolCalls) {
        const output = {
          text: 'Agent stopped: MAX_TOOL_CALLS.',
          agent: {
            status: 'LIMIT_REACHED',
            limit_reason: 'MAX_TOOL_CALLS',
            steps_used: stepNumber,
            tool_calls_used: execution.toolCallsUsed,
            tools_used: steps.map((s) => s.toolName).filter(Boolean),
          },
        };
        await this.store.updateAgentStep(step.id, {
          status: 'FAILED',
          output: { error_code: 'MAX_TOOL_CALLS' },
          completedAt: new Date().toISOString(),
        });
        await this.store.updateAgentExecution(execution.id, {
          status: 'LIMIT_REACHED',
          limitReason: 'MAX_TOOL_CALLS',
          activeDurationMs: postActionDuration,
          completedAt: new Date().toISOString(),
        });
        await this.trace(runId, nodeRunId, 'AGENT_LIMIT_REACHED', { reason: 'MAX_TOOL_CALLS' });
        return { kind: 'COMPLETED', output };
      }
      if (!node.config.allowed_tools.includes(response.action.tool_name))
        throw new Error(`Agent selected disallowed tool ${response.action.tool_name}.`);
      const args = this.registry.validate(response.action.tool_name, response.action.arguments);
      const approvalRequired = node.config.require_approval_for.includes(response.action.tool_name);
      const call = await this.store.createToolCall({
        agentStepId: step.id,
        toolName: response.action.tool_name,
        arguments: args,
        approvalRequired,
      });
      await this.store.updateAgentExecution(execution.id, {
        toolCallsUsed: execution.toolCallsUsed + 1,
      });
      await this.trace(runId, nodeRunId, 'TOOL_CALL_PROPOSED', {
        step_number: stepNumber,
        tool_name: call.toolName,
        approval_required: approvalRequired,
        safe_arguments: this.registry.safeArguments(response.action.tool_name, args),
      });
      if (approvalRequired) {
        const approval = await this.store.createApproval({
          projectId,
          runId,
          nodeRunId,
          title: 'Agent Tool Approval',
          instructions: response.action.action_summary,
          approvalType: 'AGENT_TOOL',
          toolCallId: call.id,
          safeContext: {
            agent_goal:
              typeof input.input === 'string' ? input.input.slice(0, 500) : '<structured input>',
            tool_name: call.toolName,
            sensitivity: 'HIGH',
            arguments: this.registry.safeArguments(response.action.tool_name, args),
          },
        });
        await this.store.updateToolCall(call.id, {
          status: 'WAITING_FOR_APPROVAL',
          approvalRequestId: approval.id,
        });
        await this.store.updateAgentStep(step.id, { status: 'WAITING_FOR_APPROVAL' });
        await this.store.updateAgentExecution(execution.id, {
          status: 'WAITING_FOR_APPROVAL',
          activeDurationMs: postActionDuration,
        });
        await this.trace(runId, nodeRunId, 'AGENT_WAITING_FOR_APPROVAL', {
          approval_id: approval.id,
          tool_name: call.toolName,
          step_number: stepNumber,
        });
        return { kind: 'WAITING' };
      }
      await this.runTool(call, step.id, node, runId, nodeRunId, projectId);
    }
  }
  private async runTool(
    call: ToolCallRecord,
    stepId: string,
    node: AgentNode,
    runId: string,
    nodeRunId: string,
    projectId: string,
  ) {
    const started = Date.now();
    await this.store.updateToolCall(call.id, {
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
    });
    await this.trace(runId, nodeRunId, 'TOOL_CALL_STARTED', { tool_name: call.toolName });
    try {
      const result = await this.registry.execute(call.toolName as AgentToolName, call.arguments, {
        store: this.store,
        ...(this.embeddings ? { embeddings: this.embeddings } : {}),
        logger: this.logger,
        projectId,
        runId,
        nodeRunId,
        nodeId: `${node.id}:${call.id}`,
        secrets: this.secrets,
      });
      await this.store.updateToolCall(call.id, {
        status: 'COMPLETED',
        result,
        completedAt: new Date().toISOString(),
      });
      await this.store.updateAgentStep(stepId, {
        status: 'COMPLETED',
        output: result,
        completedAt: new Date().toISOString(),
      });
      await this.trace(runId, nodeRunId, 'TOOL_CALL_COMPLETED', {
        tool_name: call.toolName,
        latency_ms: Date.now() - started,
        result_fields: Object.keys(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed.';
      const result = { status: 'FAILED', error_code: 'TOOL_FAILED', error_message: message };
      await this.store.updateToolCall(call.id, {
        status: 'FAILED',
        result,
        errorCode: 'TOOL_FAILED',
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
      await this.store.updateAgentStep(stepId, {
        status: 'COMPLETED',
        output: result,
        completedAt: new Date().toISOString(),
      });
      await this.trace(runId, nodeRunId, 'TOOL_CALL_FAILED', {
        tool_name: call.toolName,
        error_code: 'TOOL_FAILED',
        latency_ms: Date.now() - started,
      });
    }
  }
}
