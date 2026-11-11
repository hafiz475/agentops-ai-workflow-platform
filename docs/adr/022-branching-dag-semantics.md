# ADR 022: Single-parent branching DAG semantics

## Decision

Milestone 4 workflows remain acyclic and require exactly one INPUT, at least one OUTPUT, and one incoming edge for every other node. CONDITION owns exactly one `true` and one `false` edge. Joins and loops are rejected. The worker follows one branch and persists SKIPPED NodeRuns for the rejected subtree.

## Consequences

Branch behavior is deterministic, resumable, and easy to audit. General merge semantics are deferred.
