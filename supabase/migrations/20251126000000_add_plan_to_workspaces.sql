-- D1: Add plan field to workspaces table
-- This makes workspace plan directly accessible without joining subscriptions table

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'pro', 'premium'));

-- Add index for plan lookups
CREATE INDEX IF NOT EXISTS idx_workspaces_plan ON workspaces(plan);

-- Update existing workspaces to have plan from subscriptions if available
-- Default to 'basic' if no subscription exists
UPDATE workspaces w
SET plan = COALESCE(
  (SELECT s.plan_name 
   FROM subscriptions s 
   WHERE s.workspace_id = w.id 
     AND s.status = 'active' 
   ORDER BY s.updated_at DESC 
   LIMIT 1),
  'basic'
);

-- Add billing_status field (optional, for tracking subscription health)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS billing_status text CHECK (billing_status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete'));

-- Add index for billing_status
CREATE INDEX IF NOT EXISTS idx_workspaces_billing_status ON workspaces(billing_status);

-- Optional: Add stripe_customer_id and stripe_subscription_id for direct lookup
-- (These are also in subscriptions table, but having them on workspace can be convenient)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Add indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_customer ON workspaces(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_subscription ON workspaces(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

