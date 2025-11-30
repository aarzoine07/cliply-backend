-- Dev workspace seed data
-- Idempotent: safe to re-run

-- Insert main dev user
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000101', 'dev@cliply.ai')
on conflict (id) do nothing;

-- Insert test actor used by audit-logging tests
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000002', 'test-actor@cliply.ai')
on conflict (id) do nothing;

-- Insert a dev workspace owned by main dev user
insert into workspaces (id, name, owner_id)
values (
  '00000000-0000-0000-0000-000000000001',
  'Dev Workspace',
  '00000000-0000-0000-0000-000000000101'
)
on conflict (id) do nothing;

-- Add test actor user as a workspace member (REQUIRED for audit logging tests)
insert into workspace_members (workspace_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'member'
)
on conflict do nothing;

-- Insert a test project
insert into projects (
  id,
  workspace_id,
  title,
  source_type,
  source_ext,
  source_key,
  status
)
values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000001',
  'Test Project',
  'file',
  'mp4',
  'sample.mp4',
  'uploaded'
)
on conflict (id) do nothing;

-- Remove ❌ invalid "plan" insert (it does not exist in schema)
-- Replace with a real subscription row matching the subscriptions table

insert into subscriptions (
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
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000001',
  'cus_seed001',
  'sub_seed001',
  'pro',
  'price_seed001',
  'active',
  now(),
  now() + interval '30 days',
  false,
  null
)
on conflict (id) do nothing;

-- Seed a demo subscription row for tests
insert into subscriptions (
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
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000001',
  'cus_test123',
  'sub_test123',
  'pro',
  'price_test123',
  'active',
  now(),
  now() + interval '30 days',
  false,
  null
)
on conflict (id) do nothing;