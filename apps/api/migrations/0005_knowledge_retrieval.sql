CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL DEFAULT 'DOCUMENTS' CHECK (source_type IN ('DOCUMENTS')),
  embedding_provider TEXT NOT NULL CHECK (embedding_provider IN ('development','openai')),
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_sources_project_index ON knowledge_sources(project_id);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  sha256_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','PROCESSING','READY','FAILED')),
  error_message TEXT,
  raw_content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_source_id, sha256_hash)
);
CREATE INDEX IF NOT EXISTS knowledge_documents_source_index ON knowledge_documents(knowledge_source_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_project_index ON knowledge_documents(project_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_status_index ON knowledge_documents(status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  knowledge_document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  content TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_index ON knowledge_chunks(knowledge_source_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_document_index ON knowledge_chunks(knowledge_document_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_project_index ON knowledge_chunks(project_id);

CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_chunk_id UUID NOT NULL UNIQUE REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  embedding VECTOR NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_scope_index
  ON knowledge_chunk_embeddings(project_id, provider, model, dimensions);

CREATE TABLE IF NOT EXISTS citation_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_run_id UUID NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
  retrieved_chunk_ids UUID[] NOT NULL,
  cited_chunk_ids UUID[] NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS citation_validations_run_index ON citation_validations(run_id);
