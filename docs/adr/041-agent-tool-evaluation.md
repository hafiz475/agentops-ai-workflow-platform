# ADR 041: Agent and tool evaluation

## Decision

Add deterministic AGENT_SUCCESS, MAX_STEPS_EXCEEDED, EXPECTED_TOOL_USED, and FORBIDDEN_TOOL_NOT_USED evaluators to the existing evaluation framework and ordinary WorkflowRun path.

## Consequences

Evaluations measure final status and persisted tool use without an LLM judge or a fake agent executor.
