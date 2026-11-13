# ADR 037: Bounded agent limits

## Decision

Require bounded steps, tool calls, active duration, and a token ceiling: defaults 5/5/60 seconds/10,000 tokens; hard maxima 10/10/120 seconds/100,000 tokens. Persist `LIMIT_REACHED` and its reason.

## Consequences

No loop is unlimited. Token enforcement is partial when a provider returns no usage metadata; the system does not fabricate estimates.
