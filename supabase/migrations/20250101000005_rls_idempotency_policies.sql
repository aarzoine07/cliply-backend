alter table public.idempotency_keys enable row level security;

create policy "idempotency_select_same_workspace"
  on public.idempotency_keys for select
  to authenticated
  using (workspace_id() = workspace_id);

create policy "idempotency_insert_same_workspace"
  on public.idempotency_keys for insert
  to authenticated
  with check (workspace_id() = workspace_id);
