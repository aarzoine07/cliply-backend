-- ======================================================================
--  Cliply Seed Data (Local Development Only)
--  Idempotent: safe to re-run without errors
-- ======================================================================

-- ---------------------------------------------------------
-- 1. Seed main dev user
-- ---------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000101', 'dev@cliply.ai')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------
-- 2. Workspace owned by dev user
-- ---------------------------------------------------------
INSERT INTO workspaces (id, name, owner_id)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  'Dev Workspace',
  '00000000-0000-0000-0000-000000000101'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------
-- 3. Add owner membership for dev user
-- ---------------------------------------------------------
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000101',
  'owner'
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------
-- 4. Base subscription (basic, active)
-- ---------------------------------------------------------
INSERT INTO subscriptions (
  id,
  workspace_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan_name,
  price_id,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  trial_end
)
VALUES (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000101',
  'cus_seed001',
  'sub_seed001',
  'basic',
  'price_seed001',
  'active',
  now(),
  now() + interval '30 days',
  false,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------
-- 5. Second subscription for test scenarios (growth, trialing)
-- ---------------------------------------------------------
INSERT INTO subscriptions (
  id,
  workspace_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan_name,
  price_id,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  trial_end
)
VALUES (
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000101',
  'cus_test_auto',
  'sub_test_auto',
  'growth',
  'price_test_auto',
  'trialing',
  now(),
  now() + interval '14 days',
  false,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ======================================================================
-- END OF SEED FILE
-- ======================================================================