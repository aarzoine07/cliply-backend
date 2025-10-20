-- audit trail for job lifecycle
create table if not exists public.job_events (
  id bigserial primary key,
  job_id uuid references public.jobs(id) on delete cascade,
  event text not null,
  created_at timestamptz default now(),
  details jsonb
);
