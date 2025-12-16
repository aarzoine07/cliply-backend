-- Add priority column expected by worker/job tests and PostgREST inserts.

alter table public.jobs
  add column if not exists priority integer not null default 0;

comment on column public.jobs.priority is 'Job priority used for claim ordering; higher = sooner.';
