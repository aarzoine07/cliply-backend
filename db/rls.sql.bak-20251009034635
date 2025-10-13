-- db/rls.sql

ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces         ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_workspaces     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clips              ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_products      ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_has_org_link(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_workspaces ow
    JOIN organizations o ON o.id = ow.org_id
    WHERE ow.workspace_id = p_workspace_id
      AND o.owner_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS wp_select ON workspaces;
CREATE POLICY wp_select ON workspaces
  FOR SELECT
  USING (owner_id = auth.uid() OR user_has_org_link(id));

DROP POLICY IF EXISTS wp_mod ON workspaces;
CREATE POLICY wp_mod ON workspaces
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS org_select ON organizations;
CREATE POLICY org_select ON organizations
  FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS org_mod ON organizations;
CREATE POLICY org_mod ON organizations
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS orgws_select ON org_workspaces;
CREATE POLICY orgws_select ON org_workspaces
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = org_workspaces.org_id AND o.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = org_workspaces.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS prj_all ON projects;
CREATE POLICY prj_all ON projects
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = projects.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = projects.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS clip_all ON clips;
CREATE POLICY clip_all ON clips
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = clips.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = clips.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS sch_all ON schedules;
CREATE POLICY sch_all ON schedules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = schedules.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = schedules.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS ca_all ON connected_accounts;
CREATE POLICY ca_all ON connected_accounts
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS jobs_all ON jobs;
CREATE POLICY jobs_all ON jobs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = jobs.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = jobs.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS events_all ON events;
CREATE POLICY events_all ON events
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = events.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = events.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS products_all ON products;
CREATE POLICY products_all ON products
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = products.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = products.workspace_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS clip_products_all ON clip_products;
CREATE POLICY clip_products_all ON clip_products
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM clips c
      JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = clip_products.clip_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM clips c
      JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = clip_products.clip_id
        AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
    )
  );

DROP POLICY IF EXISTS rl_all ON rate_limits;
CREATE POLICY rl_all ON rate_limits
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS idem_select ON idempotency;
CREATE POLICY idem_select ON idempotency
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS idem_block_writes ON idempotency;
CREATE POLICY idem_block_writes ON idempotency
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS idem_block_updates ON idempotency;
CREATE POLICY idem_block_updates ON idempotency
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS idem_block_delete ON idempotency;
CREATE POLICY idem_block_delete ON idempotency
  FOR DELETE TO authenticated
  USING (false);
