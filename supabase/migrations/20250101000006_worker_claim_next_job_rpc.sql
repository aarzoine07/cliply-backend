-- service-role RPC for worker to claim next job
create or replace function public.worker_claim_next_job(p_worker_id text)
returns public.jobs as $$
declare
  v_job public.jobs;
begin
  select * into v_job
  from public.jobs
  where state = 'queued'
  order by priority asc, run_at asc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.jobs
    set state = 'running',
        locked_at = now(),
        locked_by = p_worker_id,
        heartbeat_at = now()
  where id = v_job.id;

  select * into v_job from public.jobs where id = v_job.id;
  return v_job;
end;
$$ language plpgsql security definer
set search_path = public;
