ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_node_run_id_key;
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'HUMAN_NODE' CHECK (approval_type IN ('HUMAN_NODE','AGENT_TOOL')),
  ADD COLUMN IF NOT EXISTS tool_call_id UUID,
  ADD COLUMN IF NOT EXISTS safe_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE, node_run_id UUID NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE UNIQUE,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','WAITING_FOR_APPROVAL','COMPLETED','FAILED','CANCELLED','LIMIT_REACHED')),
  model TEXT NOT NULL, max_steps INTEGER NOT NULL CHECK (max_steps BETWEEN 1 AND 10),
  max_duration_ms INTEGER NOT NULL CHECK (max_duration_ms BETWEEN 1000 AND 120000),
  max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls BETWEEN 0 AND 10), max_total_tokens INTEGER NOT NULL CHECK (max_total_tokens BETWEEN 100 AND 100000),
  steps_used INTEGER NOT NULL DEFAULT 0, tool_calls_used INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0, active_duration_ms INTEGER NOT NULL DEFAULT 0,
  limit_reason TEXT, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL, action_type TEXT CHECK (action_type IN ('TOOL_CALL','FINAL')), tool_name TEXT,
  action_summary TEXT, input_json JSONB NOT NULL DEFAULT '{}'::jsonb, output_json JSONB,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','WAITING_FOR_APPROVAL','COMPLETED','FAILED','CANCELLED')),
  input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_execution_id,step_number)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_step_id UUID NOT NULL REFERENCES agent_steps(id) ON DELETE CASCADE UNIQUE,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('retrieval','http_request','transform')),
  arguments_json JSONB NOT NULL, result_json JSONB, status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','WAITING_FOR_APPROVAL','RUNNING','COMPLETED','FAILED','REJECTED','CANCELLED')),
  approval_required BOOLEAN NOT NULL DEFAULT FALSE, approval_request_id UUID,
  error_code TEXT, error_message TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_tool_call_fk FOREIGN KEY (tool_call_id) REFERENCES tool_calls(id) ON DELETE CASCADE;
ALTER TABLE tool_calls ADD CONSTRAINT tool_calls_approval_fk FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_human_node_unique ON approval_requests(node_run_id) WHERE approval_type='HUMAN_NODE';
CREATE UNIQUE INDEX IF NOT EXISTS approval_agent_tool_unique ON approval_requests(tool_call_id) WHERE tool_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_executions_run_index ON agent_executions(run_id);
CREATE INDEX IF NOT EXISTS agent_steps_execution_index ON agent_steps(agent_execution_id,step_number);
