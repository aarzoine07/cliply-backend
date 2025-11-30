-- Update worker_claim_next_job RPC to use new jobs schema
-- Replaces old implementation that used state, locked_at, locked_by, heartbeat_at, run_at
-- Now uses: status, worker_id, last_heartbeat, run_after, attempts

create or replace function public.worker_claim_next_job(p_worker_id text)
returns public.jobs as $$
declare
  v_job public.jobs;
  v_now timestamptz := now();
begin
  -- Atomically select and lock one eligible job
  -- Eligible: status='queued', run_after <= now(), attempts < max_attempts
  -- Order by run_after (earliest first), then created_at (oldest first)
  select * into v_job
  from public.jobs
  where status = 'queued'
    and run_after <= v_now
    and attempts < max_attempts
  order by run_after asc, created_at asc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  -- Update the job to mark it as claimed by this worker
  update public.jobs
  set status = 'running',
      worker_id = p_worker_id,  -- worker_id is now text
      last_heartbeat = v_now,
      attempts = attempts + 1,
      updated_at = v_now
  where id = v_job.id
  returning * into v_job;

  -- Log claim event if job_events table exists
  begin
    insert into public.job_events (job_id, stage, data)
    values (v_job.id, 'claimed', jsonb_build_object('worker_id', p_worker_id))
    on conflict do nothing;
  exception
    when others then
      -- Ignore if job_events table doesn't exist or insert fails
      null;
  end;

  return v_job;
end;
$$ language plpgsql security definer
set search_path = public;

grant execute on function public.worker_claim_next_job(text)
  to anon, authenticated, service_role;

