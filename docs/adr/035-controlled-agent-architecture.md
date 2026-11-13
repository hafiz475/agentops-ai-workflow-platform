# ADR 035: Controlled agent architecture

## Decision

Implement AGENT as a node in the existing durable RunExecutor and BullMQ worker. The Python service selects one strict action per request; Node validates, dispatches, persists, and enforces policy. Fastify never runs the loop.

## Consequences

Agents inherit workflow durability, cancellation, traces, retries, project isolation, and approval semantics. Recursive agents, unrestricted autonomy, and a second executor are excluded.
