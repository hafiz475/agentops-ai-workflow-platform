# ADR 024: Structured transform safety model

## Decision

TRANSFORM recursively constructs JSON-compatible output from constants and `{{path.to.value}}` placeholders. Missing variables and non-scalar interpolation fail execution. No code, shell, or general scripting is accepted.

## Consequences

Mappings are versionable and deterministic; advanced programming constructs are out of scope.
