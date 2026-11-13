# ADR 040: No chain-of-thought persistence

## Decision

Request and store only action type, selected tool, validated safe arguments, a concise action summary, result/status, latency, and token metadata. Never request or persist hidden reasoning or scratchpads.

## Consequences

Timelines remain auditable without exposing private reasoning. Retrieved and tool content remains untrusted and prompt injection cannot be eliminated completely.
