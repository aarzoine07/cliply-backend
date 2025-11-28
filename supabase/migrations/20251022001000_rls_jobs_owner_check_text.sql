-- Replace jobs_all policy to correctly use workspace_members instead of workspaces.owner_id

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
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = jobs.workspace_id
      and m.user_id = auth.uid()
  )
);
