# ADR 029: Provider-neutral embedding boundary

## Decision

Python exposes a versioned embedding contract returning vectors, provider, model, dimensions, latency, and optional token metadata. It implements deterministic `development-hash-v1` and an OpenAI adapter. Node retrieval depends only on this contract, never SDK objects.

## Consequences

Development and tests need no credentials. A Knowledge Source fixes provider/model, and writes/searches reject mismatches rather than mixing embedding spaces. OpenAI execution is optional and must not be claimed without observed credentials-backed verification.
