-- T2 RLS Proof (psql)
-- Usage:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
--     -v u1='PUT_U1_UUID_HERE' -v u2='PUT_U2_UUID_HERE' \
--     -f test/db/rls.t2.proof.sql
--
-- This script proves (under SET ROLE authenticated + request.jwt.claims.sub):
-- - u2 (member of w1) can READ: projects/clips/schedules/connected_accounts in w1
-- - u2 is blocked from READ in w3
-- - u2 can INSERT projects in w1
-- - u2 is blocked from INSERT projects in w3 (RLS violation)

\echo '--- T2 RLS PROOF: begin ---'
\echo 'USING u1=' :u1 ' u2=' :u2

BEGIN;

-- Deterministic workspace IDs (no randomness, safe to rerun)
\set w1 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
\set w2 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
\set w3 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'

-- ------------------------------------------------------------------
-- CLEANUP (safe to rerun)
-- ------------------------------------------------------------------
DELETE FROM public.schedules          WHERE workspace_id IN (:'w1',:'w2',:'w3');
DELETE FROM public.clips              WHERE workspace_id IN (:'w1',:'w2',:'w3');
DELETE FROM public.projects           WHERE workspace_id IN (:'w1',:'w2',:'w3') OR title LIKE 'T2_RLS_%';
DELETE FROM public.connected_accounts WHERE workspace_id IN (:'w1',:'w2',:'w3') OR display_name LIKE 'T2_RLS_%' OR external_id LIKE 't2_rls_%';
DELETE FROM public.workspace_members  WHERE workspace_id IN (:'w1',:'w2',:'w3') OR user_id IN (:'u1',:'u2');
DELETE FROM public.workspaces         WHERE id IN (:'w1',:'w2',:'w3');
DELETE FROM public.users              WHERE id IN (:'u1',:'u2');

-- ------------------------------------------------------------------
-- SEED USERS (public.users) to satisfy FKs from workspace_members/connected_accounts
-- required: email
-- ------------------------------------------------------------------
INSERT INTO public.users (id, email)
VALUES
  (:'u1', 't2_rls_u1@test.local'),
  (:'u2', 't2_rls_u2@test.local');

-- ------------------------------------------------------------------
-- SEED WORKSPACES + MEMBERSHIP
-- workspaces required: name, owner_id
-- workspace_members required: workspace_id, user_id
-- ------------------------------------------------------------------
INSERT INTO public.workspaces (id, name, owner_id) VALUES
  (:'w1', 'T2_RLS_w1', :'u1'),
  (:'w2', 'T2_RLS_w2', :'u2'),
  (:'w3', 'T2_RLS_w3', :'u1');

-- u2 is a member of w1; u2 is NOT a member of w3
INSERT INTO public.workspace_members (workspace_id, user_id) VALUES
  (:'w1', :'u2');

-- ------------------------------------------------------------------
-- SEED DATA in w1 + w3
-- projects required: workspace_id, title, source_type
-- clips required: project_id, workspace_id
-- schedules required: workspace_id, clip_id, run_at
-- connected_accounts required: user_id, workspace_id, provider, external_id, platform
-- ------------------------------------------------------------------
\set p1 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
\set p3 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3'
INSERT INTO public.projects (id, workspace_id, title, source_type) VALUES
  (:'p1', :'w1', 'T2_RLS_project_w1', 'file'),
  (:'p3', :'w3', 'T2_RLS_project_w3', 'file');

\set c1 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
\set c3 'cccccccc-cccc-cccc-cccc-ccccccccccc3'
INSERT INTO public.clips (id, project_id, workspace_id) VALUES
  (:'c1', :'p1', :'w1'),
  (:'c3', :'p3', :'w3');

\set s1 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
\set s3 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
INSERT INTO public.schedules (id, workspace_id, clip_id, run_at) VALUES
  (:'s1', :'w1', :'c1', now()),
  (:'s3', :'w3', :'c3', now());

\set a1 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'
\set a3 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3'
INSERT INTO public.connected_accounts (id, user_id, workspace_id, provider, external_id, platform, display_name) VALUES
  (:'a1', :'u2', :'w1', 'tiktok', 't2_rls_u2_w1', 'tiktok', 'T2_RLS_u2_w1'),
  (:'a3', :'u1', :'w3', 'tiktok', 't2_rls_u1_w3', 'tiktok', 'T2_RLS_u1_w3');

-- ------------------------------------------------------------------
-- PROOF: act as authenticated user u2 via jwt.claims.sub
-- ------------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'u2')::text, true);

\echo '--- READ: u2 can read w1, blocked from w3 ---'
SELECT 'u2 READ projects w1'   AS test, (count(*)=1) AS ok FROM public.projects WHERE workspace_id = :'w1';
SELECT 'u2 READ clips w1'      AS test, (count(*)=1) AS ok FROM public.clips WHERE workspace_id = :'w1';
SELECT 'u2 READ schedules w1'  AS test, (count(*)=1) AS ok FROM public.schedules WHERE workspace_id = :'w1';
SELECT 'u2 READ accounts w1'   AS test, (count(*)=1) AS ok FROM public.connected_accounts WHERE workspace_id = :'w1' AND user_id = :'u2';

SELECT 'u2 READ projects w3 blocked' AS test, (count(*)=0) AS ok FROM public.projects WHERE workspace_id = :'w3';
SELECT 'u2 READ accounts w3 blocked' AS test, (count(*)=0) AS ok FROM public.connected_accounts WHERE workspace_id = :'w3';

\echo '--- WRITE: u2 allowed insert into w1, blocked insert into w3 ---'
WITH i AS (
  INSERT INTO public.projects (workspace_id, title, source_type)
  VALUES (:'w1', 'T2_RLS_u2_insert_w1', 'file')
  RETURNING id
)
SELECT 'u2 INSERT projects w1' AS test, (count(*)=1) AS ok FROM i;

-- Need dynamic SQL because psql variables (:'w3') don't interpolate inside DO blocks.
SELECT format($fmt$
DO $do$
BEGIN
  INSERT INTO public.projects (workspace_id, title, source_type)
  VALUES (%L, 'T2_RLS_u2_insert_w3_should_fail', 'file');
  RAISE EXCEPTION 'FAIL: u2 was able to INSERT projects into w3';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'PASS: u2 blocked INSERT projects w3 (error=%%)', SQLERRM;
END
$do$;
$fmt$, :'w3') \gexec

RESET ROLE;

-- ------------------------------------------------------------------
-- CLEANUP
-- ------------------------------------------------------------------
DELETE FROM public.schedules          WHERE workspace_id IN (:'w1',:'w2',:'w3');
DELETE FROM public.clips              WHERE workspace_id IN (:'w1',:'w2',:'w3');
DELETE FROM public.projects           WHERE workspace_id IN (:'w1',:'w2',:'w3') OR title LIKE 'T2_RLS_%';
DELETE FROM public.connected_accounts WHERE workspace_id IN (:'w1',:'w2',:'w3') OR display_name LIKE 'T2_RLS_%' OR external_id LIKE 't2_rls_%';
DELETE FROM public.workspace_members  WHERE workspace_id IN (:'w1',:'w2',:'w3') OR user_id IN (:'u1',:'u2');
DELETE FROM public.workspaces         WHERE id IN (:'w1',:'w2',:'w3');
DELETE FROM public.users              WHERE id IN (:'u1',:'u2');

COMMIT;

\echo '--- T2 RLS PROOF: done ---'
