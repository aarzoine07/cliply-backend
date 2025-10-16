-- Supabase migration: subscriptions table with workspace-scoped RLS.

SET check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  stripe_subscription_id text NOT NULL UNIQUE,
  plan_name text NOT NULL CHECK (plan_name IN ('basic', 'growth', 'agency')),
  price_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'trialing', 'canceled', 'incomplete', 'past_due')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_workspace_subscription_unique UNIQUE (workspace_id, stripe_subscription_id)
);

COMMENT ON TABLE public.subscriptions IS 'Workspace billing subscriptions mapped to Stripe, enforced with RLS.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON public.subscriptions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions (status);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

-- =============================
-- subscriptions RLS policies
-- =============================
DROP POLICY IF EXISTS subscriptions_service_role_full_access ON public.subscriptions;
CREATE POLICY subscriptions_service_role_full_access
  ON public.subscriptions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY subscriptions_service_role_full_access ON public.subscriptions
  IS 'Allows Supabase service_role (Stripe webhooks, backend jobs) to bypass subscription policies.';

DROP POLICY IF EXISTS subscriptions_workspace_member_read ON public.subscriptions;
CREATE POLICY subscriptions_workspace_member_read
  ON public.subscriptions
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = subscriptions.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = subscriptions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
COMMENT ON POLICY subscriptions_workspace_member_read ON public.subscriptions
  IS 'Permits workspace members to view billing data for their own workspace only.';

DROP POLICY IF EXISTS subscriptions_service_insert ON public.subscriptions;
CREATE POLICY subscriptions_service_insert
  ON public.subscriptions
  FOR INSERT
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY subscriptions_service_insert ON public.subscriptions
  IS 'Restricts subscription record creation to service role handlers (Stripe webhooks).';

DROP POLICY IF EXISTS subscriptions_service_update ON public.subscriptions;
CREATE POLICY subscriptions_service_update
  ON public.subscriptions
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON POLICY subscriptions_service_update ON public.subscriptions
  IS 'Restricts subscription updates to service role handlers (Stripe webhooks).';
