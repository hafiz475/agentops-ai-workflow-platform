# ADR 016: BullMQ durable execution queue

## Status

Accepted

## Decision

Use BullMQ over the existing Redis service. API jobs contain only persisted run identifiers. PostgreSQL remains authoritative.

## Consequences

Delivery survives API restart and supports backoff, attempts, locks, and stalled-job recovery. Redis persistence and worker monitoring are operational requirements.
