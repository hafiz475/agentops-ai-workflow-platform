# ADR 032: Retrieved-set citation validation

## Decision

Accept optional `[[SOURCE:n]]` and `[[CITE:chunk-id]]` markers in grounded LLM output. Resolve them only against the immediately preceding retrieved result set. Persist retrieved IDs, cited IDs, and source provenance; reject any invalid reference.

## Consequences

Answers cannot claim a platform-validated citation to an unretrieved chunk. Citation validation checks provenance, not factual entailment or answer quality.
