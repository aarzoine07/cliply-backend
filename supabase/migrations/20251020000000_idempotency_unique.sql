-- Ensure idempotency dedup is enforced at DB level
alter table public.idempotency_keys
  drop constraint if exists idempotency_keys_workspace_route_keyhash_unique;

alter table public.idempotency_keys
  add constraint idempotency_keys_workspace_route_keyhash_unique
  unique (workspace_id, route, key_hash);
