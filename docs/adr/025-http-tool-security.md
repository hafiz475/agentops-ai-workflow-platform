# ADR 025: HTTP is a server-executed controlled tool

## Decision

HTTP_REQUEST runs only in the worker and accepts a strict method, URL, header, body, timeout, and response-limit schema. Normalized output includes status, a safe header allowlist, parsed body/text, and latency. Secret values are resolved from project-scoped worker environment configuration and never stored in WorkflowVersions.

## Consequences

The capability can support deterministic integrations without allowing an LLM to choose arbitrary tools.
