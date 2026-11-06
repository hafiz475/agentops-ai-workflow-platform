# ADR 004: Typed workflow graph representation

## Status

Accepted

## Decision

Workflow drafts and immutable versions use a JSON graph with strict discriminated INPUT, PROMPT, LLM, and OUTPUT node schemas plus `{id, source, target}` edges. Node configuration is validated by Zod in Node and never accepted as unchecked arbitrary JSON.

Milestone 1 accepts exactly one linear execution path even though storage remains graph-shaped for later evolution.

## Consequences

ReactFlow maps directly to the persisted graph, historical versions are self-contained, and malformed node configuration is rejected at the boundary. Branching, loops, tools, and retrieval remain unsupported.
