-- background jobs table
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  kind text not null check (kind in ('TRANSCRIBE','HIGHLIGHT_DETECT','CLIP_RENDER','PUBLISH_TIKTOK','ANALYTICS_INGEST')),
  priority int default 5 check (priority between 1 and 9),
 state text not null default 'queued' check (state in ('queued','processing','done','failed')),
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

create trigger trg_jobs_updated_at
before update on public.jobs
for each row execute function public.moddatetime();
