# ADR-002: PostgreSQL for durability and Redis for transient coordination

- Status: Accepted
- Date: 2026-11-06

## Decision

Store durable product, workflow, run, and trace data in PostgreSQL. Use Redis only for transient queueing, locks, rate limits, and short-lived execution state where justified.

## Consequences

PostgreSQL remains the source of truth. Redis loss must not erase durable run history. Schema changes use reviewed, append-only migrations.
