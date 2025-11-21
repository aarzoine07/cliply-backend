-- Dev workspace seed data
-- Idempotent: safe to re-run

-- User A (workspace A owner)
insert into users (id, email)
values ('00000000-0000-0000-0000-000000000101', 'dev@cliply.ai')
on conflict (id) do nothing;

-- User B (workspace B owner)
insert into users (id, email)
values ('00000000-0000-0000-0000-000000000102', 'dev-b@cliply.ai')
on conflict (id) do nothing;

-- Workspace A
insert into workspaces (id, name, owner_id)
values ('00000000-0000-0000-0000-000000000001', 'Dev Workspace A', '00000000-0000-0000-0000-000000000101')
on conflict (id) do nothing;

-- Workspace B
insert into workspaces (id, name, owner_id)
values ('00000000-0000-0000-0000-000000000002', 'Dev Workspace B', '00000000-0000-0000-0000-000000000102')
on conflict (id) do nothing;

-- Workspace members (owners are automatically members)
insert into workspace_members (workspace_id, user_id, role)
values 
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'owner'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', 'owner')
on conflict do nothing;

-- Project in workspace A
insert into projects (id, workspace_id, title, source_type, source_path)
values ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', 'Test Project A', 'file', '/test-assets/sample.mp4')
on conflict (id) do nothing;


