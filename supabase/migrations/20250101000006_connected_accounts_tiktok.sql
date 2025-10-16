-- Supabase migration: TikTok connected accounts model with workspace-scoped RLS.
-- Ensures multi-tenant isolation with explicit service_role bypass.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure base table and required columns exist
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE CASCADE,
  platform text,
  access_token_encrypted_ref text,
  refresh_token_encrypted_ref text,
  scopes text[],
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add missing columns if table already existed
ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS access_token_encrypted_ref text,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted_ref text,
  ADD COLUMN IF NOT EXISTS scopes text[],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Ensure NOT NULL constraints apply safely
ALTER TABLE public.connected_accounts
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN platform SET NOT NULL;

-- Update constraints and indexes
ALTER TABLE public.connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_platform_check;
ALTER TABLE public.connected_accounts
  ADD CONSTRAINT connected_accounts_platform_check
  CHECK (platform IN ('tiktok'));

ALTER TABLE public.connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_workspace_platform_unique;

CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_workspace_platform_key
  ON public.connected_accounts (workspace_id, platform);

CREATE INDEX IF NOT EXISTS connected_accounts_expires_idx
  ON public.connected_accounts (expires_at);

-- Comments for documentation
COMMENT ON TABLE public.connected_accounts
  IS 'OAuth accounts connected per workspace; stores references to encrypted tokens for TikTok.';

COMMENT ON COLUMN public.connected_accounts.access_token_encrypted_ref
  IS 'Reference to sealed access token in secure storage (never persist plaintext tokens).';

COMMENT ON COLUMN public.connected_accounts.refresh_token_encrypted_ref
  IS 'Reference to sealed refresh token in secure storage (never persist plaintext tokens).';

COMMENT ON COLUMN public.connected_accounts.scopes
  IS 'TikTok OAuth scopes associated with this connection (e.g. video.upload, video.publish).';

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION public.set_connected_accounts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_connected_accounts_updated_at ON public.connected_accounts;
CREATE TRIGGER trg_connected_accounts_updated_at
  BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_connected_accounts_updated_at();

-- Enable and enforce RLS
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_accounts FORCE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS service_role_full_access ON public.connected_accounts;
CREATE POLICY service_role_full_access
  ON public.connected_accounts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY service_role_full_access ON public.connected_accounts
  IS 'Allows Supabase service_role clients (webhooks, jobs) to fully manage connected accounts.';

DROP POLICY IF EXISTS workspace_member_read ON public.connected_accounts;
CREATE POLICY workspace_member_read
  ON public.connected_accounts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = public.connected_accounts.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY workspace_member_read ON public.connected_accounts
  IS 'Allows workspace members to view connected account metadata for their workspace.';
