# ADR 007: Control-plane execution ownership

## Status

Accepted

## Decision

The Node control plane validates and orders the graph, creates runs/node runs/traces, renders prompts, coordinates node state, and maps final output. Python performs only provider-neutral model generation.

Milestone 1 queues work with an isolated in-process `RunExecutor` after returning HTTP 202. Redis remains available but a durable worker is deferred to avoid expanding this milestone.

## Consequences

Product persistence stays in PostgreSQL and the browser never calls Python. A control-plane process crash can strand queued/running work; durable Redis workers and recovery are future hardening.
