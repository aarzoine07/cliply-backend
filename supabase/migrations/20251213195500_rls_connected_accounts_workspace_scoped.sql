-- Hardens connected_accounts RLS to be workspace-scoped for authenticated users.
-- Fixes: A-01 (connected_accounts dual access pattern)

begin;

-- Remove overly-permissive / duplicate policies
drop policy if exists "ca_all" on public.connected_accounts;
drop policy if exists "workspace_member_read" on public.connected_accounts;

drop policy if exists "service_role_full_access" on public.connected_accounts;
drop policy if exists "connected_accounts_service_role_full_access" on public.connected_accounts;

drop policy if exists "connected_accounts_workspace_member_read" on public.connected_accounts;
drop policy if exists "connected_accounts_workspace_member_modify" on public.connected_accounts;

-- Authenticated workspace members can read
create policy "connected_accounts_workspace_member_read"
on public.connected_accounts
as permissive
for select
to authenticated
using (is_workspace_member(workspace_id));

-- Authenticated workspace members can modify (insert/update/delete)
create policy "connected_accounts_workspace_member_modify"
on public.connected_accounts
as permissive
for all
to authenticated
using (is_workspace_member(workspace_id))
with check (is_workspace_member(workspace_id));

-- Service role can do anything (used by OAuth callbacks / server-side admin client)
create policy "connected_accounts_service_role_full_access"
on public.connected_accounts
as permissive
for all
to public
using (auth.role() = 'service_role'::text)
with check (auth.role() = 'service_role'::text);

commit;
