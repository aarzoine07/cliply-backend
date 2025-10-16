-- Supabase migration: users table with strict RLS.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  default_workspace_id uuid REFERENCES public.workspaces (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_default_workspace_id ON public.users (default_workspace_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- =============================
-- users RLS policies
-- =============================
DROP POLICY IF EXISTS users_service_role_full_access ON public.users;
CREATE POLICY users_service_role_full_access
  ON public.users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY users_service_role_full_access ON public.users
  IS 'Allows Supabase service_role to bypass user row policies for backend automation.';

DROP POLICY IF EXISTS users_self_select ON public.users;
CREATE POLICY users_self_select
  ON public.users
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() = id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);
COMMENT ON POLICY users_self_select ON public.users
  IS 'Allows each authenticated user to fetch their own profile row only.';

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update
  ON public.users
  FOR UPDATE
  USING (auth.uid() IS NOT NULL AND auth.uid() = id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);
COMMENT ON POLICY users_self_update ON public.users
  IS 'Restricts profile updates to the corresponding user.';

DROP POLICY IF EXISTS users_self_delete ON public.users;
CREATE POLICY users_self_delete
  ON public.users
  FOR DELETE
  USING (auth.uid() IS NOT NULL AND auth.uid() = id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);
COMMENT ON POLICY users_self_delete ON public.users
  IS 'Restricts profile deletions to the corresponding user.';

DROP POLICY IF EXISTS users_self_insert ON public.users;
CREATE POLICY users_self_insert
  ON public.users
  FOR INSERT
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);
COMMENT ON POLICY users_self_insert ON public.users
  IS 'Allows authenticated users to insert a profile row that matches their auth user id.';
