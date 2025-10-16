-- Supabase migration: workspaces & workspace_members with RLS
-- Ensures multi-tenant isolation with explicit service_role bypass.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces (owner_id);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_workspace_user_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_user ON public.workspace_members (workspace_id, user_id);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;

-- =============================
-- workspaces RLS policies
-- =============================
DROP POLICY IF EXISTS workspaces_service_role_full_access ON public.workspaces;
CREATE POLICY workspaces_service_role_full_access
  ON public.workspaces
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY workspaces_service_role_full_access ON public.workspaces
  IS 'Allows Supabase service_role to bypass workspace policies for backend jobs and webhooks.';

DROP POLICY IF EXISTS workspaces_owner_read ON public.workspaces;
CREATE POLICY workspaces_owner_read
  ON public.workspaces
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() = owner_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = owner_id);
COMMENT ON POLICY workspaces_owner_read ON public.workspaces
  IS 'Permits workspace owners to read their own workspace records.';

DROP POLICY IF EXISTS workspaces_owner_update ON public.workspaces;
CREATE POLICY workspaces_owner_update
  ON public.workspaces
  FOR UPDATE
  USING (auth.uid() IS NOT NULL AND auth.uid() = owner_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = owner_id);
COMMENT ON POLICY workspaces_owner_update ON public.workspaces
  IS 'Restricts workspace updates to the owning user.';

DROP POLICY IF EXISTS workspaces_owner_delete ON public.workspaces;
CREATE POLICY workspaces_owner_delete
  ON public.workspaces
  FOR DELETE
  USING (auth.uid() IS NOT NULL AND auth.uid() = owner_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = owner_id);
COMMENT ON POLICY workspaces_owner_delete ON public.workspaces
  IS 'Restricts workspace deletions to the owning user.';

DROP POLICY IF EXISTS workspaces_owner_insert ON public.workspaces;
CREATE POLICY workspaces_owner_insert
  ON public.workspaces
  FOR INSERT
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = owner_id);
COMMENT ON POLICY workspaces_owner_insert ON public.workspaces
  IS 'Allows any authenticated user to create a workspace they personally own.';

-- =============================
-- workspace_members RLS policies
-- =============================
DROP POLICY IF EXISTS workspace_members_service_role_full_access ON public.workspace_members;
CREATE POLICY workspace_members_service_role_full_access
  ON public.workspace_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY workspace_members_service_role_full_access ON public.workspace_members
  IS 'Allows Supabase service_role to fully manage workspace membership.';

DROP POLICY IF EXISTS workspace_members_member_read ON public.workspace_members;
CREATE POLICY workspace_members_member_read
  ON public.workspace_members
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm_self
      WHERE wm_self.workspace_id = workspace_members.workspace_id
        AND wm_self.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm_self
      WHERE wm_self.workspace_id = workspace_members.workspace_id
        AND wm_self.user_id = auth.uid()
    )
  );
COMMENT ON POLICY workspace_members_member_read ON public.workspace_members
  IS 'Allows workspace members to view the roster for workspaces they belong to.';

DROP POLICY IF EXISTS workspace_members_owner_insert ON public.workspace_members;
CREATE POLICY workspace_members_owner_insert
  ON public.workspace_members
  FOR INSERT
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );
COMMENT ON POLICY workspace_members_owner_insert ON public.workspace_members
  IS 'Allows workspace owners to add members to their workspace.';

DROP POLICY IF EXISTS workspace_members_owner_update ON public.workspace_members;
CREATE POLICY workspace_members_owner_update
  ON public.workspace_members
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );
COMMENT ON POLICY workspace_members_owner_update ON public.workspace_members
  IS 'Restricts membership updates (role changes) to the corresponding workspace owner.';

DROP POLICY IF EXISTS workspace_members_owner_delete ON public.workspace_members;
CREATE POLICY workspace_members_owner_delete
  ON public.workspace_members
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );
COMMENT ON POLICY workspace_members_owner_delete ON public.workspace_members
  IS 'Restricts membership removals to the corresponding workspace owner.';
