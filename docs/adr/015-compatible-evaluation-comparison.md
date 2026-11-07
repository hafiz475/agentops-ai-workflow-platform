# ADR 015: Compare compatible completed evaluation runs

- Status: Accepted
- Date: 2026-11-07

## Context

Prompt iteration needs evidence of quality, latency, and token changes rather than isolated run summaries.

## Decision

Compare two completed EvaluationRuns only when they share a project and EvaluationDataset. Their WorkflowVersions may differ, which is the primary comparison use case. Return both snapshots plus calculated pass-rate, latency, and token deltas, including selected PromptVersion IDs.

## Consequences

The comparison is meaningful and reproducible without replay. Cross-dataset comparison is rejected instead of presenting misleading deltas; WorkflowVersion and PromptVersion identities remain explicit in both summaries.
