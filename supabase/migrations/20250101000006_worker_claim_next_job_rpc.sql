-- service-role RPC for worker to claim next job
create or replace function public.worker_claim_next_job(p_worker_id text)
returns public.jobs as $$
declare
  v_job public.jobs;
begin
  -- Check if priority column exists, use it if available
  -- Otherwise order by run_at only
  BEGIN
    select * into v_job
    from public.jobs
    where state = 'queued'  -- Implicitly excludes dead_letter (which is not 'queued')
      and (run_at is null or run_at <= now())  -- Only claim jobs that are ready to run
    order by priority asc, run_at asc nulls last
    limit 1
    for update skip locked;
  EXCEPTION WHEN undefined_column THEN
    -- Fallback if priority column doesn't exist
    select * into v_job
    from public.jobs
    where state = 'queued'
      and (run_at is null or run_at <= now())
    order by run_at asc nulls last
    limit 1
    for update skip locked;
  END;

  if not found then
    return null;
  end if;

  -- Update job to running state
  -- Handle optional columns (locked_at, locked_by, heartbeat_at) gracefully
  BEGIN
    update public.jobs
      set state = 'running',
          locked_at = now(),
          locked_by = p_worker_id,
          heartbeat_at = now()
    where id = v_job.id;
  EXCEPTION WHEN undefined_column THEN
    -- Fallback if some columns don't exist
    update public.jobs
      set state = 'running'
    where id = v_job.id;
  END;

  select * into v_job from public.jobs where id = v_job.id;
  return v_job;
end;
$$ language plpgsql security definer
set search_path = public;
