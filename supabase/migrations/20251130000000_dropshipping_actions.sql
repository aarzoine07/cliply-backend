-- D4: Dropshipping Viral Actions Table
-- Stores planned actions (e.g. reposts) for underperforming posts

CREATE TABLE IF NOT EXISTS dropshipping_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  clip_id uuid REFERENCES clips(id) ON DELETE SET NULL,
  variant_post_id uuid REFERENCES variant_posts(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('repost')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'executed', 'skipped')),
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  planned_creative jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  skipped_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dropshipping_actions_workspace_product ON dropshipping_actions(workspace_id, product_id);
CREATE INDEX IF NOT EXISTS idx_dropshipping_actions_workspace_status ON dropshipping_actions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_dropshipping_actions_variant_post ON dropshipping_actions(variant_post_id);

-- Unique constraint: at most one planned action per variant_post
CREATE UNIQUE INDEX IF NOT EXISTS idx_dropshipping_actions_variant_post_planned 
  ON dropshipping_actions(variant_post_id) 
  WHERE status = 'planned';

-- Enable RLS
ALTER TABLE dropshipping_actions ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY dropshipping_actions_service_role_full_access
  ON dropshipping_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workspace members can read/write their workspace actions
CREATE POLICY dropshipping_actions_workspace_member_access
  ON dropshipping_actions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = dropshipping_actions.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = dropshipping_actions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

