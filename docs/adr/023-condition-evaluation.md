# ADR 023: Declarative condition evaluation

## Decision

CONDITION reads a controlled dot path and uses an allowlisted comparison operator. It never evaluates JavaScript or another expression language.

## Consequences

Rules are predictable and safe but intentionally less expressive than executable predicates.
