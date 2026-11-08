ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK (status IN ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','COMPLETED','FAILED','CANCELLED'));
ALTER TABLE node_runs DROP CONSTRAINT IF EXISTS node_runs_status_check;
ALTER TABLE node_runs ADD CONSTRAINT node_runs_status_check CHECK (status IN ('PENDING','RUNNING','WAITING','COMPLETED','FAILED','SKIPPED','CANCELLED'));
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS queue_job_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS node_runs_run_node_unique ON node_runs(run_id, node_id);
CREATE INDEX IF NOT EXISTS runs_status_index ON runs(status);
CREATE INDEX IF NOT EXISTS runs_queue_job_id_index ON runs(queue_job_id);
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE, node_run_id UUID NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  title TEXT NOT NULL, instructions TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ,
  decision TEXT, reviewer_id TEXT, reviewer_label TEXT, reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (node_run_id)
);
CREATE INDEX IF NOT EXISTS approval_requests_project_index ON approval_requests(project_id);
CREATE INDEX IF NOT EXISTS approval_requests_run_index ON approval_requests(run_id);
CREATE INDEX IF NOT EXISTS approval_requests_status_index ON approval_requests(status);

