-- Supabase migration: rate_limits token bucket with RLS and helper functions.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- rate_limits table stores per-workspace feature token buckets.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  feature text NOT NULL,
  tokens integer NOT NULL DEFAULT 0,
  capacity integer NOT NULL DEFAULT 0,
  refill_rate integer NOT NULL DEFAULT 0,
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limits_workspace_feature_unique UNIQUE (workspace_id, feature)
);

COMMENT ON TABLE public.rate_limits IS 'Workspace-scoped token buckets used for request throttling and feature gating.';

CREATE INDEX IF NOT EXISTS idx_rate_limits_workspace_id ON public.rate_limits (workspace_id);

-- ============================================================
-- Token bucket helper functions.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_refill_tokens(p_workspace_id uuid, p_feature text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_rate integer;
  v_capacity integer;
  v_tokens integer;
  v_last_refill timestamptz;
  v_elapsed_seconds numeric;
  v_refill_amount integer;
BEGIN
  SELECT refill_rate, capacity, tokens, last_refill_at
  INTO v_rate, v_capacity, v_tokens, v_last_refill
  FROM public.rate_limits
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No existing bucket; create default zero-capacity row for future updates.
    INSERT INTO public.rate_limits (workspace_id, feature)
    VALUES (p_workspace_id, p_feature)
    ON CONFLICT (workspace_id, feature) DO NOTHING;
    RETURN;
  END IF;

  v_elapsed_seconds := EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_refill, v_now)));
  IF v_rate > 0 AND v_elapsed_seconds > 0 THEN
    v_refill_amount := FLOOR((v_elapsed_seconds / 3600) * v_rate);
    IF v_refill_amount > 0 THEN
      v_tokens := LEAST(v_capacity, v_tokens + v_refill_amount);
      v_last_refill := v_now;
    END IF;
  END IF;

  UPDATE public.rate_limits
  SET tokens = v_tokens,
      last_refill_at = v_last_refill,
      updated_at = v_now
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature;
END;
$$;

COMMENT ON FUNCTION public.fn_refill_tokens(uuid, text)
  IS 'Recalculate available tokens for a workspace feature bucket using elapsed time and refill rate.';

CREATE OR REPLACE FUNCTION public.fn_consume_token(p_workspace_id uuid, p_feature text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_tokens integer;
  v_now timestamptz := now();
BEGIN
  PERFORM public.fn_refill_tokens(p_workspace_id, p_feature);

  SELECT tokens
  INTO v_tokens
  FROM public.rate_limits
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_tokens > 0 THEN
    UPDATE public.rate_limits
    SET tokens = v_tokens - 1,
        updated_at = v_now
    WHERE workspace_id = p_workspace_id
      AND feature = p_feature;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.fn_consume_token(uuid, text)
  IS 'Attempt to consume a single token for a workspace feature; returns true when successful.';

-- ============================================================
-- Row-Level Security policies to ensure tenant isolation.
-- ============================================================
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limits_service_role_full_access ON public.rate_limits;
CREATE POLICY rate_limits_service_role_full_access
  ON public.rate_limits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY rate_limits_service_role_full_access ON public.rate_limits
  IS 'Allows service_role clients to manage rate limit buckets across tenants.';

DROP POLICY IF EXISTS rate_limits_workspace_member_read ON public.rate_limits;
CREATE POLICY rate_limits_workspace_member_read
  ON public.rate_limits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = public.rate_limits.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY rate_limits_workspace_member_read ON public.rate_limits
  IS 'Allows workspace members to read their own rate limit configuration.';

-- End of migration.
