-- Patched: owner_id no longer exists on public.workspaces.
-- Recreate a minimal safe jobs_all policy without referencing owner_id.

drop policy if exists jobs_all on public.jobs;

create policy jobs_all
on public.jobs
as permissive
for all
to public
using (
  exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = jobs.workspace_id
      and m.user_id::text = current_setting('request.jwt.claim.sub', true)
  )
)
with check (
  exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = jobs.workspace_id
      and m.user_id::text = current_setting('request.jwt.claim.sub', true)
  )
);

