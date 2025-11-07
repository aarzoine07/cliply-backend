-- Dev workspace seed data
-- Idempotent: safe to re-run

insert into users (id, email)
values ('00000000-0000-0000-0000-000000000101', 'dev@cliply.ai')
on conflict (id) do nothing;

insert into workspaces (id, name, owner_id)
values ('00000000-0000-0000-0000-000000000001', 'Dev Workspace', '00000000-0000-0000-0000-000000000101')
on conflict (id) do nothing;

insert into projects (id, workspace_id, title, source_type, source_path)
values ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', 'Test Project', 'file', '/test-assets/sample.mp4')
on conflict (id) do nothing;

