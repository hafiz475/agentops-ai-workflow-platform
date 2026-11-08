# ADR 020: Cooperative cancellation

## Status

Accepted

## Decision

Cancel queued/waiting runs immediately; record a cancellation request for running runs and stop between nodes. Terminal calls are idempotent. Human rejection maps to `CANCELLED` with `HUMAN_REJECTED`.

## Consequences

State is safe and traceable without unsafe thread interruption. An in-flight provider request finishes or reaches its request timeout.
