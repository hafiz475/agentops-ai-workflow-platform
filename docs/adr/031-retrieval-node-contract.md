# ADR 031: RETRIEVAL node contract

## Decision

RETRIEVAL is a normal durable RunExecutor node configured with a project-owned Knowledge Source, controlled query path, bounded top K, and optional document filter. Output contains the query, ranked chunks, provenance, explicit score type, and deterministic grounded context.

## Consequences

Retrieval inherits NodeRun persistence, retries, cancellation, branching, and approval behavior without a second engine. Unknown/empty paths, missing embeddings, model mismatches, and cross-project sources fail clearly.
