# ADR 014: Persist aggregate evaluation metrics

- Status: Accepted
- Date: 2026-11-07

## Context

Users need fast summaries of completed evaluations while retaining auditable per-case data.

## Decision

Persist case results as the source evidence and store derived totals, pass rate, average latency, p50/p95 latency, and token totals on EvaluationRun when execution completes.

## Consequences

Dashboards and comparisons are simple and fast. Metrics must be recomputed by a migration or maintenance task if aggregation rules change.
