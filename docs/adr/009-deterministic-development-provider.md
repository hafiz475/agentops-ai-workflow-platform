# ADR 009: Deterministic development provider and OpenAI adapter

## Status

Accepted

## Decision

`AI_PROVIDER=development` is the default and returns `DEV_RESPONSE: <prompt>` without network calls. `AI_PROVIDER=openai` selects an OpenAI Responses API adapter only when an API key is configured; otherwise local development safely falls back to the development provider.

## Consequences

Full workflow tests require no credentials and are deterministic. The UI labels development mode clearly. The adapter is implemented but live provider behavior is not claimed as tested without a real key.
