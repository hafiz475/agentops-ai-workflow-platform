# ADR-003: Runtime-validated, versioned API contracts

- Status: Accepted
- Date: 2026-11-06

## Decision

Define service contracts in a small shared TypeScript package and validate responses at runtime. Version service routes under `/v1` when they carry domain behavior.

## Consequences

Static types alone are not trusted across a network boundary. Contract changes require compatibility review and tests. Python models must remain semantically aligned with the published contract.
