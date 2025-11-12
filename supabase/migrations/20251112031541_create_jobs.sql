create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed', 'completed')),
  attempts integer not null default 0,
  last_error text,
  next_run_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- add missing columns if table already exists
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'next_run_at') then
    alter table public.jobs add column next_run_at timestamptz default now();
  end if;
  
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'type') then
    alter table public.jobs add column type text;
  end if;
  
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'last_error') then
    alter table public.jobs add column last_error text;
  end if;
end $$;

alter table public.jobs enable row level security;

-- drop existing policy if it exists, then create new one
drop policy if exists "jobs_are_workspace_scoped" on public.jobs;

create policy "jobs_are_workspace_scoped"
on public.jobs
using (exists (
  select 1 from public.workspace_members
  where workspace_members.workspace_id = jobs.workspace_id
  and workspace_members.user_id = auth.uid()
));

-- basic index for worker polling
create index if not exists jobs_next_run_idx on public.jobs (status, next_run_at);

