# ADR 028: Project-scoped Knowledge Source architecture

## Decision

Represent reusable corpora as KnowledgeSource, KnowledgeDocument, and ordered KnowledgeChunk records under one project. Upload bytes and ingestion status remain durable in PostgreSQL, while ingestion is delivered through a dedicated BullMQ queue consumed by the existing worker.

## Consequences

Workflow validation and execution enforce project ancestry. SHA-256 duplicate detection and transactional chunk replacement make retry safe. The 5 MiB TXT/PDF/DOCX limit is intentionally modest; object storage and large ingestion pipelines are deferred.
