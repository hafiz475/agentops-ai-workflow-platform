# Agent guidelines

## Scope

AgentOps Studio is a production-style workflow platform, not a chatbot demo. Build in tested vertical slices. Keep the Node control plane separate from Python AI execution concerns.

## Required checks

Before completing a change, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the Python checks documented in the README. Validate Compose when infrastructure changes.

## Engineering rules

- Never commit credentials or expose provider keys to the browser.
- Use versioned contracts between services.
- Validate all external input at service boundaries.
- Persist errors and traces; never silently swallow execution failures.
- Add tests for important behavior and architecture decisions for consequential choices.
- Keep planned capabilities visibly distinct from implemented behavior.
