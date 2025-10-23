-- Replace jobs_all policy to avoid 22P02 when JWT sub isn't a UUID
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
      and (
        -- compare on text to avoid invalid UUID casts when sub is not a UUID
        w.owner_id::text = current_setting('request.jwt.claim.sub', true)
        or user_has_org_link(w.id)
      )
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = jobs.workspace_id
      and (
        w.owner_id::text = current_setting('request.jwt.claim.sub', true)
        or user_has_org_link(w.id)
      )
  )
);
