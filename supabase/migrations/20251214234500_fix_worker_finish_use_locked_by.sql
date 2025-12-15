-- Fix worker_finish to use locked_by (text) instead of worker_id (uuid)
-- This matches worker_claim_next_job and worker_fail which use text worker ids.

-- Drop the old signature to avoid overload ambiguity via RPC.
drop function if exists public.worker_finish(uuid, uuid, jsonb);

create or replace function public.worker_finish(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns public.jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  j public.jobs;
begin
  update public.jobs
     set status = 'succeeded',
         state = 'done',
         result = coalesce(p_result, '{}'::jsonb),
         heartbeat_at = now(),
         updated_at = now()
   where id = p_job_id
     and locked_by = p_worker_id
  returning * into j;

  if not found then
    raise exception 'Job not found or worker_id mismatch' using errcode = 'P0002';
  end if;

  insert into public.job_events(job_id, stage, data)
  values (j.id, 'finished', coalesce(p_result, '{}'::jsonb));

  return j;
end;
$$;

-- Keep RPC callable by service_role explicitly.
grant execute on function public.worker_finish(uuid, text, jsonb) to service_role;