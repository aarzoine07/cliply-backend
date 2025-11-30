-- Add worker_fail RPC with exponential backoff support
-- Handles retry logic: if attempts < max_attempts, reschedules with backoff; otherwise marks as failed

create or replace function public.worker_fail(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_backoff_seconds integer default 0
) returns public.jobs
language plpgsql security definer as $$
declare
  v_job public.jobs;
  v_now timestamptz := now();
  v_new_run_after timestamptz;
  v_backoff_interval interval;
begin
  -- Verify job belongs to worker and is running
  select * into v_job
  from public.jobs
  where id = p_job_id
    and worker_id = p_worker_id  -- worker_id is now text
    and status = 'running';

  if not found then
    raise exception 'Job not found, not running, or worker_id mismatch' using errcode = 'P0002';
  end if;

  -- Calculate backoff interval
  -- If p_backoff_seconds is provided, use it; otherwise compute exponential backoff
  if p_backoff_seconds > 0 then
    v_backoff_interval := (p_backoff_seconds || ' seconds')::interval;
  else
    -- Exponential backoff: 2^(attempts) * 30 seconds, capped at 30 minutes
    v_backoff_interval := least(
      ((power(2, v_job.attempts) * 30)::text || ' seconds')::interval,
      '30 minutes'::interval
    );
  end if;

  v_new_run_after := v_now + v_backoff_interval;

  -- Check if we've exceeded max attempts
  if v_job.attempts >= v_job.max_attempts then
    -- Mark as permanently failed
    update public.jobs
    set status = 'failed',
        error = jsonb_build_object('message', p_error, 'attempts', v_job.attempts, 'failed_at', v_now),
        last_heartbeat = v_now,
        updated_at = v_now
    where id = p_job_id
    returning * into v_job;

    -- Log failure event
    begin
      insert into public.job_events (job_id, stage, data)
      values (v_job.id, 'failed', jsonb_build_object('error', p_error, 'attempts', v_job.attempts))
      on conflict do nothing;
    exception
      when others then
        null;
    end;
  else
    -- Reschedule for retry
    update public.jobs
    set status = 'queued',
        worker_id = null,  -- Clear worker_id so it can be claimed by any worker
        run_after = v_new_run_after,
        error = jsonb_build_object('message', p_error, 'attempts', v_job.attempts, 'retry_at', v_new_run_after),
        last_heartbeat = v_now,
        updated_at = v_now
    where id = p_job_id
    returning * into v_job;

    -- Log retry event
    begin
      insert into public.job_events (job_id, stage, data)
      values (v_job.id, 'progress', jsonb_build_object('error', p_error, 'attempts', v_job.attempts, 'retry_at', v_new_run_after))
      on conflict do nothing;
    exception
      when others then
        null;
    end;
  end if;

  return v_job;
end;
$$;

grant execute on function public.worker_fail(uuid, text, text, integer)
  to anon, authenticated, service_role;

-- Add worker_reclaim_stale RPC to reclaim jobs that haven't heartbeated recently
-- Finds running jobs with stale heartbeats and resets them to queued

create or replace function public.worker_reclaim_stale(
  p_stale_seconds integer default 120
) returns integer
language plpgsql security definer as $$
declare
  v_now timestamptz := now();
  v_stale_threshold timestamptz;
  v_reclaimed_count integer;
begin
  v_stale_threshold := v_now - (p_stale_seconds || ' seconds')::interval;

  -- Find and reset stale running jobs
  -- Reset: status='queued', worker_id=null, run_after=now (immediately eligible)
  update public.jobs
  set status = 'queued',
      worker_id = null,
      run_after = v_now,
      updated_at = v_now
  where status = 'running'
    and (
      last_heartbeat is null
      or last_heartbeat < v_stale_threshold
    );

  get diagnostics v_reclaimed_count = row_count;

  -- Log reclaimed jobs if any
  if v_reclaimed_count > 0 then
    begin
      insert into public.job_events (job_id, stage, data)
      select id, 'progress', jsonb_build_object('reclaimed_at', v_now, 'reason', 'stale_heartbeat')
      from public.jobs
      where status = 'queued'
        and worker_id is null
        and run_after = v_now
        and updated_at = v_now
      on conflict do nothing;
    exception
      when others then
        null;
    end;
  end if;

  return v_reclaimed_count;
end;
$$;

grant execute on function public.worker_reclaim_stale(integer)
  to anon, authenticated, service_role;

