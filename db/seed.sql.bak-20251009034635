-- db/seed.sql
-- NOTE: Replace the UUID below with a real auth user ID in your environment if desired.
DO $$
DECLARE
  v_owner uuid := '00000000-0000-0000-0000-000000000001';
  v_org   uuid;
  v_ws    uuid;
BEGIN
  INSERT INTO organizations (id, name, owner_id)
  VALUES (gen_random_uuid(), 'Demo Org', v_owner)
  RETURNING id INTO v_org;

  INSERT INTO workspaces (id, name, owner_id, org_id)
  VALUES (gen_random_uuid(), 'Demo Workspace', v_owner, v_org)
  RETURNING id INTO v_ws;

  INSERT INTO projects (id, workspace_id, title, source_type, status)
  VALUES (gen_random_uuid(), v_ws, 'Welcome Project', 'file', 'queued');
END
$$;
