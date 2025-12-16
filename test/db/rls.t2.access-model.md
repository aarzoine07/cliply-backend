# T2 — RLS & Access Model (Surface Tables)

## Goal
Ensure “surface” tables enforce workspace membership via RLS (not only owner_id), and document expected access.

## Tables covered
- projects
- clips
- schedules
- connected_accounts

## Intended access model
Within a workspace:
- Owner and workspace members can READ data for that workspace.
- Owner and workspace members can WRITE data for that workspace (create/update as allowed by table rules).
Across workspaces:
- Users are BLOCKED from READ/WRITE for workspaces they are not members of.

## RLS helper
`public.is_workspace_member(p_workspace_id uuid)`:
- Evaluates membership by checking `workspace_members.user_id = auth.uid()`

## Proof (SQL)
Proof script:
- `test/db/rls.t2.proof.sql`

Run (example):
- `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -v u1='<uuid>' -v u2='<uuid>' -f test/db/rls.t2.proof.sql`

What it proves (u2):
- Can READ projects/clips/schedules/connected_accounts in member workspace (w1)
- BLOCKED from READ in non-member workspace (w3)
- Can INSERT projects in w1
- BLOCKED from INSERT projects in w3 (RLS violation)

## Migration (RLS hardening)
- `supabase/migrations/20251214000000_rls_content_tables_use_membership_helper.sql`

## API alignment note
Workspace validation middleware:
- `apps/web/src/middleware/validateWorkspaceHeader.ts`
- Uses **anon + user JWT** and `rpc("is_workspace_member")` so RLS enforces membership (no service role required here).
