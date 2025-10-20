-- idempotency keys
create table if not exists public.idempotency_keys (
  id bigserial primary key,
  workspace_id uuid not null,
  route text not null,
  key_hash text not null,
  response jsonb,
  created_at timestamptz default now(),
  unique (workspace_id, route, key_hash)
);
