-- Seed script for plan gate verification
-- Usage: Replace ${WSID} with your workspace_id, then run via Supabase CLI or Dashboard
-- Example: supabase db execute < scripts/seed-plan-gate-test.sql

-- 1. Ensure a 'basic' active subscription exists
-- Note: subscriptions table uses plan_name (not plan) and requires stripe_customer_id/stripe_subscription_id
INSERT INTO subscriptions (
  workspace_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan_name,
  price_id,
  status,
  current_period_end,
  updated_at
)
VALUES (
  '${WSID}',
  'cus_test_' || substr(md5(random()::text), 1, 14),
  'sub_test_' || substr(md5(random()::text), 1, 14),
  'basic',
  'price_test_basic',
  'active',
  now() + interval '7 days',
  now()
)
ON CONFLICT (workspace_id, stripe_subscription_id) 
DO UPDATE SET 
  status = 'active',
  plan_name = 'basic',
  updated_at = excluded.updated_at;

-- 2. Ensure a test clip exists (required for schedules foreign key)
DO $$
DECLARE
  test_project_id uuid;
  test_clip_id uuid;
BEGIN
  -- Get or create a test project
  SELECT id INTO test_project_id
  FROM projects
  WHERE workspace_id = '${WSID}'
  LIMIT 1;

  IF test_project_id IS NULL THEN
    INSERT INTO projects (workspace_id, title, source_type, status)
    VALUES ('${WSID}', 'Test Project for Plan Gate', 'file', 'ready')
    RETURNING id INTO test_project_id;
  END IF;

  -- Get or create a test clip
  SELECT id INTO test_clip_id
  FROM clips
  WHERE workspace_id = '${WSID}' AND project_id = test_project_id
  LIMIT 1;

  IF test_clip_id IS NULL THEN
    INSERT INTO clips (workspace_id, project_id, title, status)
    VALUES ('${WSID}', test_project_id, 'Test Clip', 'ready')
    RETURNING id INTO test_clip_id;
  END IF;
END $$;

-- 3. Clear existing today's schedules
DELETE FROM schedules
WHERE workspace_id = '${WSID}'
  AND created_at >= date_trunc('day', now())
  AND created_at < date_trunc('day', now()) + interval '1 day';

-- 4. Insert 6 schedules for today (exceeds basic limit of 5)
DO $$
DECLARE
  i int;
  test_clip_id uuid;
BEGIN
  -- Get a clip_id for this workspace
  SELECT id INTO test_clip_id
  FROM clips
  WHERE workspace_id = '${WSID}'
  LIMIT 1;

  -- If no clip exists, raise error
  IF test_clip_id IS NULL THEN
    RAISE EXCEPTION 'No clip found for workspace. Please create a clip first.';
  END IF;

  -- Insert 6 schedules (exceeds basic plan limit of 5)
  FOR i IN 1..6 LOOP
    INSERT INTO schedules (workspace_id, clip_id, run_at, created_at)
    VALUES (
      '${WSID}',
      test_clip_id,
      now() + interval '1 minute' * i,
      now()
    );
  END LOOP;
END $$;

-- 5. Verify the count
SELECT 
  COUNT(*) as schedule_count,
  (SELECT plan_name FROM subscriptions WHERE workspace_id = '${WSID}' AND status IN ('active', 'trialing') LIMIT 1) as plan_name
FROM schedules
WHERE workspace_id = '${WSID}'
  AND created_at >= date_trunc('day', now())
  AND created_at < date_trunc('day', now()) + interval '1 day';

