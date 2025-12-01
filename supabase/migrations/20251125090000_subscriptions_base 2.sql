-- Base table for subscriptions
-- Derived from the remote schema snapshot, with clean constraints and FK alignment.
-- Later migrations may add additional fields or policies.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text NOT NULL,
  plan_name              text NOT NULL,
  price_id               text NOT NULL,
  status                 text NOT NULL,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  trial_end              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS base enablement (policies added later)
ALTER TABLE public.subscriptions
  ENABLE ROW LEVEL SECURITY;

-- Basic lookup indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace
  ON public.subscriptions(workspace_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
  ON public.subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription
  ON public.subscriptions(stripe_subscription_id);

-- Auto-update updated_at
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');