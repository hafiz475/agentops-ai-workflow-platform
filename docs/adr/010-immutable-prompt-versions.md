# ADR 010: Immutable prompt versions

- Status: Accepted
- Date: 2026-11-07

## Context

Workflows need reusable prompts that can be compared and reproduced without silently changing historical executions.

## Decision

Store prompt identity separately from append-only, numbered PromptVersions. Workflow PROMPT nodes may reference a PromptVersion ID. Validate that references belong to the workflow project and resolve the immutable template at run time. Keep inline templates readable for Milestone 1 compatibility.

## Consequences

Executions and evaluations are reproducible and comparison labels are precise. Editing means creating a new version, and deletion/update endpoints for versions are intentionally absent.
