-- Create idempotency_keys (used by enqueueJob() dedupe)
create table if not exists public.idempotency_keys (
  id bigserial primary key,
  workspace_id uuid not null,
  route text not null,
  key_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, route, key_hash)
);

-- Optional index for faster lookups (safe even with UNIQUE)
create index if not exists idempotency_keys_lookup_idx
  on public.idempotency_keys (workspace_id, route, key_hash);

-- Keep consistent with other tables (service_role bypasses RLS)
alter table public.idempotency_keys enable row level security;

-- Ensure PostgREST via service_role can read/write
grant all on table public.idempotency_keys to service_role;
grant all on sequence public.idempotency_keys_id_seq to service_role;
