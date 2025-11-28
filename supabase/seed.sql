-- Dev workspace seed data
-- Idempotent: safe to re-run

-- Insert a dev user into Supabase Auth (auth.users)
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000101', 'dev@cliply.ai')
on conflict (id) do nothing;

-- Insert a dev workspace owned by that user
insert into workspaces (id, name, owner_id)
values ('00000000-0000-0000-0000-000000000001', 'Dev Workspace', '00000000-0000-0000-0000-000000000101')
on conflict (id) do nothing;

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