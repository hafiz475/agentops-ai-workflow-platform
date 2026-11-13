# ADR 036: Explicit Tool Registry

## Decision

Expose only named, typed `retrieval`, `http_request`, and `transform` definitions. Validate model output against both the allowlist and each JSON-compatible input schema, then call the existing M4/M5 implementations.

## Consequences

Unknown names and malformed arguments fail before dispatch. No workflow node, shell, code runtime, filesystem, or browser becomes implicitly callable.
