-- Adds workspace_members access to core content tables.
-- Fixes: H-01 (projects/clips/schedules), C-01 (clips), E-04 (schedules)

begin;

-- ─────────────────────────────────────────────────────────────
-- clips
-- ─────────────────────────────────────────────────────────────
drop policy if exists "clip_all" on public.clips;

create policy "clip_all"
on public.clips
as permissive
for all
to public
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = clips.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = clips.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
);

-- ─────────────────────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────────────────────
drop policy if exists "prj_all" on public.projects;

create policy "prj_all"
on public.projects
as permissive
for all
to public
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = projects.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = projects.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
);

-- ─────────────────────────────────────────────────────────────
-- schedules
-- ─────────────────────────────────────────────────────────────
drop policy if exists "sch_all" on public.schedules;

create policy "sch_all"
on public.schedules
as permissive
for all
to public
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = schedules.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = schedules.workspace_id
      and (
        w.owner_id = auth.uid()
        or public.user_has_org_link(w.id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.user_id = auth.uid()
        )
      )
  )
);

commit;
