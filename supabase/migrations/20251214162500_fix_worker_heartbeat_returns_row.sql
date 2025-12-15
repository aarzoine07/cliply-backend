-- Fix worker_heartbeat RPC to return a jsonb row (id + heartbeat_at)
-- Needed because CREATE OR REPLACE cannot change return type.

begin;

drop function if exists public.worker_heartbeat(uuid, text);

create function public.worker_heartbeat(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_heartbeat_at timestamptz;
begin
  update public.jobs
  set heartbeat_at = now()
  where id = p_job_id
    and state = 'running'
    and locked_by = p_worker_id
  returning id, heartbeat_at into v_id, v_heartbeat_at;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'heartbeat_at', v_heartbeat_at
  );
end;
$$;

grant execute on function public.worker_heartbeat(uuid, text) to authenticated;
grant execute on function public.worker_heartbeat(uuid, text) to service_role;

commit;
