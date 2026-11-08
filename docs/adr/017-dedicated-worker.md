# ADR 017: Dedicated execution worker

## Status

Accepted

## Decision

Run workflow and evaluation consumers in a dedicated Node process using the shared RunExecutor. The Fastify process only validates, persists, enqueues, and serves state.

## Consequences

API restarts do not own or lose executions. Worker and API deploy from one image but have separate commands and responsibilities.
