# ADR 027: HTTP retry and idempotency semantics

## Decision

GET may use the existing bounded retry path for timeouts, transport failures, 429, 502, 503, and 504. POST, PUT, and PATCH are permanent failures by default; retry requires explicit opt-in plus a deterministic idempotency-key header based on run and node IDs.

## Consequences

Accidental duplicate side effects are reduced. The platform explicitly does not claim exactly-once semantics for external systems.
