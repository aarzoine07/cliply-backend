-- ME-I-09: Worker heartbeats and stuck job recovery
-- This migration adds:
--   1. worker_heartbeat RPC to update heartbeat_at for running jobs
--   2. worker_recover_stuck_jobs RPC to recover stale running jobs

-- ============================================================================
-- 1. Worker Heartbeat RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.worker_heartbeat(
  p_job_id uuid,
  p_worker_id text
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  -- Update heartbeat_at only for running jobs owned by this worker
  UPDATE public.jobs
  SET
    heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND locked_by = p_worker_id
    AND state = 'running'
  RETURNING * INTO v_job;

  -- Return null if job not found or no longer running / owned by worker
  -- This is a no-op, not an error (job may have completed/failed)
  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.worker_heartbeat(uuid, text)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 2. Stuck Job Recovery RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.worker_recover_stuck_jobs(
  p_stale_after_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - make_interval(secs => p_stale_after_seconds);
  v_affected integer := 0;
  v_job public.jobs;
  v_attempts integer;
  v_max_attempts integer;
  v_error_payload jsonb;
  v_stale_since timestamptz;
BEGIN
  -- Process each stuck job
  FOR v_job IN
    SELECT *
    FROM public.jobs
    WHERE state = 'running'
      AND coalesce(heartbeat_at, locked_at) < v_cutoff
  LOOP
    -- Calculate attempts and max_attempts
    v_attempts := COALESCE(v_job.attempts, 0) + 1;
    v_max_attempts := COALESCE(v_job.max_attempts, 5);
    v_stale_since := coalesce(v_job.heartbeat_at, v_job.locked_at);
    
    -- Build error payload with stuck job recovery reason
    v_error_payload := coalesce(v_job.error, '{}'::jsonb) || jsonb_build_object(
      'reason', 'stuck_job_recovery',
      'message', 'Stuck job recovery: heartbeat stale',
      'stale_since', v_stale_since,
      'stale_after_seconds', p_stale_after_seconds,
      'attempts', v_attempts,
      'max_attempts', v_max_attempts,
      'recovered_at', v_now
    );

    -- Determine next state based on attempts
    IF v_attempts >= v_max_attempts THEN
      -- Move to dead_letter
      UPDATE public.jobs
      SET
        state = 'dead_letter',
        attempts = v_attempts,
        last_error = 'Stuck job recovery: heartbeat stale',
        error = v_error_payload,
        locked_at = NULL,
        locked_by = NULL,
        heartbeat_at = NULL,
        updated_at = v_now
      WHERE id = v_job.id;

      -- Log dead_letter event
      INSERT INTO public.job_events (job_id, stage, data)
      VALUES (v_job.id, 'failed', jsonb_build_object(
        'stage', 'dead_letter',
        'reason', 'stuck_job_recovery_max_attempts',
        'attempts', v_attempts,
        'max_attempts', v_max_attempts,
        'stale_since', v_stale_since,
        'stale_after_seconds', p_stale_after_seconds
      ));
    ELSE
      -- Re-queue for retry
      UPDATE public.jobs
      SET
        state = 'queued',
        attempts = v_attempts,
        last_error = 'Stuck job recovery: heartbeat stale',
        error = v_error_payload,
        locked_at = NULL,
        locked_by = NULL,
        heartbeat_at = NULL,
        run_at = v_now,  -- Make it eligible immediately
        updated_at = v_now
      WHERE id = v_job.id;

      -- Log retry event
      INSERT INTO public.job_events (job_id, stage, data)
      VALUES (v_job.id, 'failed', jsonb_build_object(
        'stage', 'retry_scheduled',
        'reason', 'stuck_job_recovery',
        'attempts', v_attempts,
        'max_attempts', v_max_attempts,
        'stale_since', v_stale_since,
        'stale_after_seconds', p_stale_after_seconds,
        'next_run_at', v_now::text
      ));
    END IF;
    
    v_affected := v_affected + 1;
  END LOOP;

  -- Return count of affected jobs
  RETURN v_affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.worker_recover_stuck_jobs(integer)
  TO anon, authenticated, service_role;

