# ADR 033: Deterministic retrieval evaluation

## Decision

Add Hit@K, Recall@K, and MRR evaluators using expected chunk or document IDs, plus required/forbidden citation checks. Cases execute through the existing durable WorkflowRun path.

## Consequences

Metrics are reproducible and measure observed ranked retrieval. They do not claim semantic answer quality, and no LLM judge or alternate execution engine is introduced.
