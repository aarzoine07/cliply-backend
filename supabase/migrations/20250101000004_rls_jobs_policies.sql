-- enable RLS + policies for jobs table
alter table public.jobs enable row level security;

create policy "jobs_select_same_workspace"
  on public.jobs for select
  to authenticated
  using (workspace_id() = workspace_id);

create policy "jobs_insert_same_workspace"
  on public.jobs for insert
  to authenticated
  with check (workspace_id() = workspace_id);

create policy "jobs_update_same_workspace"
  on public.jobs for update
  to authenticated
  using (workspace_id() = workspace_id);

create policy "jobs_delete_same_workspace"
  on public.jobs for delete
  to authenticated
  using (workspace_id() = workspace_id);
