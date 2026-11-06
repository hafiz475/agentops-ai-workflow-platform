# ADR 005: Deterministic graph validation with Kahn's algorithm

## Status

Accepted

## Decision

The control plane validates graph cardinality, strict node configuration, edge references, degree constraints, connectivity, reachability, and cycles before version creation and execution. Kahn's algorithm with lexically sorted queues produces a deterministic topological order and detects cycles when not every node can be emitted.

## Consequences

The frontend node array is never trusted as execution order. Invalid cycles and disconnected paths return detailed 422 responses. The same validator protects version creation and run execution.
