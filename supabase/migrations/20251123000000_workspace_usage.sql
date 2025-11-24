-- Create workspace_usage table for tracking usage metrics per workspace per period
CREATE TABLE IF NOT EXISTS workspace_usage (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start  date NOT NULL, -- First day of the period (YYYY-MM-01 for monthly)
  source_minutes numeric NOT NULL DEFAULT 0 CHECK (source_minutes >= 0),
  clips_count    integer NOT NULL DEFAULT 0 CHECK (clips_count >= 0),
  projects_count integer NOT NULL DEFAULT 0 CHECK (projects_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_workspace_usage_ws_period ON workspace_usage(workspace_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_usage_period ON workspace_usage(period_start);

-- Enable RLS
ALTER TABLE workspace_usage ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY workspace_usage_service_role_full_access
  ON workspace_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workspace members can read their workspace usage
CREATE POLICY workspace_usage_workspace_member_read
  ON workspace_usage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_usage.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

