# ADR-001: Node control plane and Python execution service

- Status: Accepted
- Date: 2026-11-06

## Decision

Use React for the web UI, Fastify/TypeScript for the control plane, and FastAPI/Python for AI execution. Communication from control plane to execution plane uses versioned HTTP contracts.

## Rationale

TypeScript gives the product API and browser shared type tooling, while Python provides the strongest model and evaluation ecosystem. An explicit boundary prevents model-provider concerns from leaking into product APIs.

## Consequences

Cross-service failures and contract compatibility must be handled deliberately. The extra process is justified by independent ownership and scaling of AI execution.
