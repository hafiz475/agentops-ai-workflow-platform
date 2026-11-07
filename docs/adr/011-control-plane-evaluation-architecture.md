# ADR 011: Evaluation architecture in the control plane

- Status: Accepted
- Date: 2026-11-07

## Context

Evaluation coordinates stored workflows, prompt versions, datasets, execution traces, and aggregate metrics.

## Decision

Keep evaluation orchestration in the Node control plane through an isolated EvaluationExecutor. Python remains a stateless generation adapter.

## Consequences

Project isolation and persistence stay in one boundary, and evaluation can reuse normal execution. The current in-process executor is not durable across API termination.
