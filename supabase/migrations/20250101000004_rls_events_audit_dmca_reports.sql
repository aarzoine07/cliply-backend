-- Supabase migration: compliance audit and DMCA reporting tables with RLS.
-- Retention guidance:
--   * events_audit: retain at least 90 days for compliance investigations.
--   * dmca_reports: retain until resolution + 180 days to satisfy legal obligations.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.events_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.events_audit IS 'Immutable audit trail of Cliply workspace events; retain for ≥90 days.';

CREATE INDEX IF NOT EXISTS idx_events_audit_workspace_id ON public.events_audit (workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_audit_event_type ON public.events_audit (event_type);
CREATE INDEX IF NOT EXISTS idx_events_audit_created_at_desc ON public.events_audit (created_at DESC);

CREATE TABLE IF NOT EXISTS public.dmca_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  clip_id uuid,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dmca_reports IS 'Workspace DMCA submission log; retain through resolution plus 180 days.';

CREATE INDEX IF NOT EXISTS idx_dmca_reports_workspace_id ON public.dmca_reports (workspace_id);
CREATE INDEX IF NOT EXISTS idx_dmca_reports_status ON public.dmca_reports (status);

ALTER TABLE public.events_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dmca_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dmca_reports FORCE ROW LEVEL SECURITY;

-- =============================
-- events_audit RLS policies
-- =============================
DROP POLICY IF EXISTS events_audit_service_role_full_access ON public.events_audit;
CREATE POLICY events_audit_service_role_full_access
  ON public.events_audit
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY events_audit_service_role_full_access ON public.events_audit
  IS 'Allows service_role automation (jobs, webhooks) to insert and manage audit rows.';

DROP POLICY IF EXISTS events_audit_workspace_member_read ON public.events_audit;
CREATE POLICY events_audit_workspace_member_read
  ON public.events_audit
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = events_audit.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = events_audit.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY events_audit_workspace_member_read ON public.events_audit
  IS 'Permits workspace members to view audit events belonging to their workspace.';

DROP POLICY IF EXISTS events_audit_service_insert ON public.events_audit;
CREATE POLICY events_audit_service_insert
  ON public.events_audit
  FOR INSERT
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY events_audit_service_insert ON public.events_audit
  IS 'Restricts audit log insertion to service_role jobs to maintain integrity.';

-- No explicit UPDATE/DELETE policies for non-service roles; absence blocks client writes.

-- =============================
-- dmca_reports RLS policies
-- =============================
DROP POLICY IF EXISTS dmca_reports_service_role_full_access ON public.dmca_reports;
CREATE POLICY dmca_reports_service_role_full_access
  ON public.dmca_reports
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY dmca_reports_service_role_full_access ON public.dmca_reports
  IS 'Grants service_role automation full control for moderation workflows.';

DROP POLICY IF EXISTS dmca_reports_workspace_member_read ON public.dmca_reports;
CREATE POLICY dmca_reports_workspace_member_read
  ON public.dmca_reports
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = dmca_reports.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = dmca_reports.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY dmca_reports_workspace_member_read ON public.dmca_reports
  IS 'Permits workspace members to review DMCA reports tied to their workspace.';

DROP POLICY IF EXISTS dmca_reports_member_insert ON public.dmca_reports;
CREATE POLICY dmca_reports_member_insert
  ON public.dmca_reports
  FOR INSERT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = dmca_reports.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND dmca_reports.reporter_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = dmca_reports.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY dmca_reports_member_insert ON public.dmca_reports
  IS 'Allows workspace members to submit DMCA reports for their workspace with themselves as reporter.';

DROP POLICY IF EXISTS dmca_reports_service_update ON public.dmca_reports;
CREATE POLICY dmca_reports_service_update
  ON public.dmca_reports
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY dmca_reports_service_update ON public.dmca_reports
  IS 'Restricts DMCA status updates to service_role moderation systems.';

-- No explicit DELETE policy: only service_role (via full access) can remove rows.
