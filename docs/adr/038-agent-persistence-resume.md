# ADR 038: Agent persistence and resume

## Decision

Persist AgentExecution, unique numbered AgentSteps, and one ToolCall per tool step. Resume reconstructs observations from completed steps and continues the next incomplete checkpoint.

## Consequences

API/worker restarts, BullMQ retry, and approval pauses do not restart at step one. Completed HTTP results are reused, but exactly-once remote side effects are not claimed across the pre-checkpoint crash window.
