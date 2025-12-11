-- Base table for connected_accounts
-- Foundational columns + required foreign keys, indexes, and trigger.
-- Additional fields (display_name, handle, status, YouTube-specific fields, etc.)
-- are added by later migrations already in the repo.

CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  workspace_id               uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider                   text NOT NULL,
  external_id                text NOT NULL,
  platform                   text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz,
  access_token_encrypted_ref text,
  refresh_token_encrypted_ref text,
  scopes                     text[]
);

-- Add FK to auth.users (Supabase standard)
ALTER TABLE public.connected_accounts
  ADD CONSTRAINT connected_accounts_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- Base unique constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connected_accounts_provider_external_id_key'
  ) THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_provider_external_id_key
      UNIQUE (provider, external_id);
  END IF;
END$$;

DO $$
BEGIN
  -- Guard on any existing relation (index or constraint) with this name
  IF to_regclass('public.connected_accounts_workspace_platform_key') IS NULL THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_workspace_platform_key
      UNIQUE (workspace_id, platform);
  END IF;
END$$;

-- Index to support expiry-based cleanup / queries
CREATE INDEX IF NOT EXISTS idx_connected_accounts_expires_at
  ON public.connected_accounts(expires_at);

-- Enable RLS (later migrations may add policies)
ALTER TABLE public.connected_accounts
  ENABLE ROW LEVEL SECURITY;

-- Basic updated_at trigger (later migrations may adjust, but this is safe base behavior)
-- Basic updated_at trigger (later migrations may adjust, but this is safe base behavior)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_connected_accounts_updated_at'
  ) THEN
    CREATE TRIGGER trg_connected_accounts_updated_at
      BEFORE UPDATE ON public.connected_accounts
      FOR EACH ROW
      EXECUTE FUNCTION moddatetime('updated_at');
  END IF;
END$$;