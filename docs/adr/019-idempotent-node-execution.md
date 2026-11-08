# ADR 019: Idempotent node checkpoints

## Status

Accepted

## Decision

Enforce unique `(run_id,node_id)` NodeRuns and reuse persisted output for completed nodes on duplicate delivery or resume.

## Consequences

Completed nodes and final output are not duplicated. A provider call can repeat only in the unavoidable crash window before its response is checkpointed.
