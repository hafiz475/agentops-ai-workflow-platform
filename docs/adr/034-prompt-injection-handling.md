# ADR 034: Retrieved text prompt-injection handling

## Decision

Treat every retrieved chunk as untrusted data. Render a deterministic format with document/page/chunk provenance, explicit untrusted-data labels, and hard delimiters separate from workflow/system instructions. Avoid object stringification and omit full source text from traces/logs.

## Consequences

The boundary improves instruction/data separation and trace safety, but prompt injection cannot be completely eliminated. Sensitive deployments still require trusted-source policy, provider controls, authentication, and human review.
