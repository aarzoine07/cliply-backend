-- Change worker_id column from uuid to text to match worker implementation
-- Worker sends text identifiers like "hostname:pid:timestamp", not UUIDs

-- First, update any existing RPCs that reference worker_id as uuid
-- Then alter the column type

alter table public.jobs
  alter column worker_id type text using worker_id::text;

-- Update worker_finish to accept text instead of uuid
create or replace function public.worker_finish(
  p_job_id uuid,
  p_worker_id text,  -- Changed from uuid to text
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
   where id = p_job_id and worker_id = p_worker_id  -- Now compares text to text
   returning * into j;

  if not found then
    raise exception 'Job not found or worker_id mismatch' using errcode = 'P0002';
  end if;

  insert into public.job_events(job_id, stage, data)
  values (j.id, 'finished', p_result);

  return j;
end
$$;

grant execute on function public.worker_finish(uuid, text, jsonb)  -- Updated signature
  to anon, authenticated, service_role;

