drop policy if exists jobs_all on public.jobs;

create policy jobs_all
on public.jobs
as permissive
for all
to public
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = jobs.workspace_id
      and text(w.owner_id) = text(current_setting('request.jwt.claim.sub', true))
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = jobs.workspace_id
      and text(w.owner_id) = text(current_setting('request.jwt.claim.sub', true))
  )
);
