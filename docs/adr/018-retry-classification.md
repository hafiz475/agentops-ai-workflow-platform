# ADR 018: Bounded retry classification

## Status

Accepted

## Decision

Allow three attempts with bounded exponential backoff for transport timeouts, HTTP 429, and provider/service 5xx failures. Validation, configuration, project scope, and human rejection are permanent.

## Consequences

Transient outages recover without infinite retries. Attempt and retry trace events explain every replay.
