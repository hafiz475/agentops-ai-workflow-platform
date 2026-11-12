# ADR 030: PostgreSQL pgvector storage

## Decision

Store one versioned pgvector embedding per KnowledgeChunk in the existing PostgreSQL service. Use cosine distance for ordering and return the derived value explicitly as `cosine_similarity`.

## Consequences

No separate vector database, port, credential, or consistency boundary is introduced. Project/source/model predicates constrain every search. Specialized indexes and distributed vector storage are deferred.
