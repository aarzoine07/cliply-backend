-- Supabase migration: connected_accounts table with workspace-scoped RLS.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('tiktok', 'youtube')),
  account_username text,
  access_token_encrypted_ref text,
  refresh_token_encrypted_ref text,
  scopes text[],
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connected_accounts_workspace_platform_unique UNIQUE (workspace_id, platform)
);

COMMENT ON TABLE public.connected_accounts IS 'External social accounts connected per workspace; tokens stored as encrypted references.';
COMMENT ON COLUMN public.connected_accounts.access_token_encrypted_ref IS 'Opaque reference to encrypted access token material; never store plaintext tokens.';
COMMENT ON COLUMN public.connected_accounts.refresh_token_encrypted_ref IS 'Opaque reference to encrypted refresh token material; never store plaintext tokens.';

CREATE INDEX IF NOT EXISTS idx_connected_accounts_workspace_id ON public.connected_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_expires_at ON public.connected_accounts (expires_at);

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_accounts FORCE ROW LEVEL SECURITY;

-- =============================
-- connected_accounts RLS policies
-- =============================
DROP POLICY IF EXISTS connected_accounts_service_role_full_access ON public.connected_accounts;
CREATE POLICY connected_accounts_service_role_full_access
  ON public.connected_accounts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY connected_accounts_service_role_full_access ON public.connected_accounts
  IS 'Allows Supabase service_role clients to manage connected accounts for automation and webhooks.';

DROP POLICY IF EXISTS connected_accounts_workspace_member_read ON public.connected_accounts;
CREATE POLICY connected_accounts_workspace_member_read
  ON public.connected_accounts
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = connected_accounts.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = connected_accounts.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY connected_accounts_workspace_member_read ON public.connected_accounts
  IS 'Permits workspace members to read connected accounts scoped to their workspace.';
