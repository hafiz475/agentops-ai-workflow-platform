# ADR 012: Deterministic evaluator abstraction

- Status: Accepted
- Date: 2026-11-07

## Context

Milestone 2 needs reliable scoring without adding another model call or nondeterministic judge.

## Decision

Represent evaluators as a strict discriminated union and implement EXACT_MATCH, CONTAINS, NOT_CONTAINS, REGEX, and a deliberately limited JSON_SCHEMA evaluator behind one interface.

## Consequences

Tests and comparisons are repeatable and inexpensive. Semantic/model-judge evaluation and complete JSON Schema coverage are deferred.
