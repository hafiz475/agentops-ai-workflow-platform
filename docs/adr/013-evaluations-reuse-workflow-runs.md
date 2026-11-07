# ADR 013: Evaluation cases reuse normal workflow runs

- Status: Accepted
- Date: 2026-11-07

## Context

A separate evaluation execution path would drift from interactive workflow behavior and weaken traceability.

## Decision

For each evaluation case, create a normal WorkflowRun and invoke the existing RunExecutor. Persist the resulting Run ID on EvaluationCaseResult.

## Consequences

Node traces, provider calls, failures, and outputs have one implementation and every case links to its detailed trace. Large datasets will eventually require durable parallel workers.
