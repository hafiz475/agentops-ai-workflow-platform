CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prompts_project_id_idx ON prompts(project_id);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  template TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(prompt_id, version_number)
);
CREATE INDEX IF NOT EXISTS prompt_versions_prompt_id_idx ON prompt_versions(prompt_id);

CREATE TABLE IF NOT EXISTS evaluation_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_datasets_project_id_idx ON evaluation_datasets(project_id);

CREATE TABLE IF NOT EXISTS evaluation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES evaluation_datasets(id) ON DELETE CASCADE,
  input_json JSONB NOT NULL,
  expected_output_json JSONB NOT NULL,
  evaluator_config JSONB NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_cases_dataset_id_idx ON evaluation_cases(dataset_id);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES evaluation_datasets(id) ON DELETE RESTRICT,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed_cases INTEGER NOT NULL DEFAULT 0,
  failed_cases INTEGER NOT NULL DEFAULT 0,
  average_score DOUBLE PRECISION,
  average_latency_ms DOUBLE PRECISION,
  p50_latency_ms DOUBLE PRECISION,
  p95_latency_ms DOUBLE PRECISION,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_runs_project_id_idx ON evaluation_runs(project_id);
CREATE INDEX IF NOT EXISTS evaluation_runs_dataset_id_idx ON evaluation_runs(dataset_id);
CREATE INDEX IF NOT EXISTS evaluation_runs_workflow_version_id_idx ON evaluation_runs(workflow_version_id);

CREATE TABLE IF NOT EXISTS evaluation_case_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  evaluation_case_id UUID NOT NULL REFERENCES evaluation_cases(id) ON DELETE RESTRICT,
  workflow_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  actual_output_json JSONB,
  score DOUBLE PRECISION,
  passed BOOLEAN,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(evaluation_run_id, evaluation_case_id)
);
CREATE INDEX IF NOT EXISTS evaluation_case_results_run_id_idx ON evaluation_case_results(evaluation_run_id);
CREATE INDEX IF NOT EXISTS evaluation_case_results_workflow_run_id_idx ON evaluation_case_results(workflow_run_id);

INSERT INTO schema_migrations(version) VALUES ('0003_prompt_evaluations') ON CONFLICT DO NOTHING;