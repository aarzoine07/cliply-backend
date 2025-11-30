-- Add worker_heartbeat RPC to update last_heartbeat for a running job
-- Verifies the job belongs to the worker before updating

create or replace function public.worker_heartbeat(
  p_job_id uuid,
  p_worker_id text
) returns public.jobs
language plpgsql security definer as $$
declare
  v_job public.jobs;
  v_now timestamptz := now();
begin
  -- Update heartbeat only if job is running and belongs to this worker
  update public.jobs
  set last_heartbeat = v_now,
      updated_at = v_now
  where id = p_job_id
    and worker_id = p_worker_id  -- worker_id is now text
    and status = 'running'
  returning * into v_job;

  if not found then
    raise exception 'Job not found, not running, or worker_id mismatch' using errcode = 'P0002';
  end if;

  return v_job;
end;
$$;

grant execute on function public.worker_heartbeat(uuid, text)
  to anon, authenticated, service_role;

