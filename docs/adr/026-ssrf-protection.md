# ADR 026: DNS-aware SSRF protection

## Decision

Only HTTP(S) is accepted. Literal and resolved loopback, private, carrier-grade NAT, link-local, multicast, metadata, and internal service destinations are blocked. DNS is checked before every request and redirect. Redirects are manual, same-origin, and limited to three. Responses are streamed with a 1 MiB default and 5 MiB maximum.

## Consequences

The worker cannot intentionally reach Compose/Azure internal services through this tool. DNS validation reduces rebinding risk but is not represented as an absolute TOCTOU guarantee.
