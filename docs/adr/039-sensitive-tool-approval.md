# ADR 039: Sensitive-tool approval

## Decision

Reuse ApprovalRequest with an `AGENT_TOOL` discriminator and ToolCall link. Persist only redacted destination/method/key metadata, exit the worker while pending, and queue resume after either decision. Rejection becomes `REJECTED_BY_HUMAN` feedback.

## Consequences

No worker blocks on a person. A rejected action can produce a bounded alternative while ordinary HUMAN_APPROVAL rejection keeps its existing cancellation semantics.
