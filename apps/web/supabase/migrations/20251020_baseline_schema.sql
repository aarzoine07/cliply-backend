-- 🧱 Cliply Baseline Schema (Jobs + Idempotency + Job Events)
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  kind text not null check (kind in ('TRANSCRIBE','HIGHLIGHT_DETECT','CLIP_RENDER','PUBLISH_TIKTOK','ANALYTICS_INGEST')),
  priority int default 5 check (priority between 1 and 9),
  state text default 'queued' check (state in ('queued','running','done','error')),
  payload jsonb default '{}'::jsonb,
  result jsonb,
  attempts int default 0,
  max_attempts int default 5,
  last_error text,
  run_at timestamptz default now(),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  route text not null,
  key_hash text not null,
  response jsonb,
  created_at timestamptz default now(),
  unique (workspace_id, route, key_hash)
);

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  event text not null,
  data jsonb,
  created_at timestamptz default now()
);

alter table public.jobs enable row level security;

create or replace function public.workspace_id()
returns uuid as $$
  select nullif(current_setting('request.jwt.claims.workspace_id', true), '')::uuid;
$$ language sql stable;

create policy "jobs_select_same_workspace"
  on public.jobs
  for select
  to authenticated
  using (workspace_id() = workspace_id);

create policy "jobs_insert_same_workspace"
  on public.jobs
  for insert
  to authenticated
  using (workspace_id() = workspace_id)
  with check (workspace_id() = workspace_id);
