# ADR 008: Versioned Node-to-Python generation contract

## Status

Accepted

## Decision

Node calls `POST /v1/generate` with run ID, node ID, resolved prompt, model, and temperature. Zod validates the request and response in Node; Pydantic validates both sides in Python. Responses are provider-neutral: text, provider, model, latency, and nullable token counts.

## Consequences

Provider SDK shapes do not leak into the control plane. Contract drift fails tests. Provider errors become safe 502 responses without raw stack traces or credentials.
