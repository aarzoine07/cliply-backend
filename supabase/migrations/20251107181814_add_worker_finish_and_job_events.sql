-- Create job_events table
create table if not exists public.job_events (
  id bigserial primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage text not null check (stage in ('enqueued','claimed','progress','finished','failed')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.job_events to anon, authenticated, service_role;

-- Trigger to log claimed events
create or replace function public.jobs_log_claim_event()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.state = 'running'
     and (OLD.state is distinct from 'running') then
    insert into public.job_events (job_id, stage, data)
    values (NEW.id, 'claimed', jsonb_build_object('worker_id', NEW.worker_id));
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_jobs_log_claim on public.jobs;
create trigger trg_jobs_log_claim
after update on public.jobs
for each row
when (OLD.state is distinct from NEW.state)
execute procedure public.jobs_log_claim_event();

-- worker_finish function
create or replace function public.worker_finish(
  p_job_id uuid,
  p_worker_id uuid,
  p_result jsonb
) returns public.jobs
language plpgsql security invoker as $$
declare
  j public.jobs;
begin
  update public.jobs
     set status = 'succeeded',
         state = 'done',
         result = coalesce(p_result, '{}'::jsonb),
         last_heartbeat = now(),
         updated_at = now()
   where id = p_job_id and worker_id = p_worker_id
   returning * into j;

  if not found then
    raise exception 'Job not found or worker_id mismatch' using errcode = 'P0002';
  end if;

  insert into public.job_events(job_id, stage, data)
  values (j.id, 'finished', p_result);

  return j;
end
$$;
grant execute on function public.worker_finish(uuid, uuid, jsonb)
  to anon, authenticated, service_role;

-- Add missing column
alter table public.jobs
  add column if not exists result jsonb default '{}'::jsonb;
