-- ME-I-07: Create worker_fail RPC for handling job failures and DLQ transition
-- This RPC handles job failures, increments attempts, and moves jobs to dead_letter
-- when max_attempts is exceeded.

CREATE OR REPLACE FUNCTION public.worker_fail(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_backoff_seconds integer DEFAULT 0
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_attempts integer;
  v_max_attempts integer;
  v_error_payload jsonb;
BEGIN
  -- Load current job state
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
    AND (locked_by = p_worker_id OR locked_by IS NULL);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or worker_id mismatch' USING errcode = 'P0002';
  END IF;

  v_attempts := COALESCE(v_job.attempts, 0) + 1;
  v_max_attempts := COALESCE(v_job.max_attempts, 5);

  -- Build structured error payload
  v_error_payload := jsonb_build_object(
    'message', p_error,
    'attempts', v_attempts,
    'max_attempts', v_max_attempts,
    'failed_at', now(),
    'worker_id', p_worker_id
  );

  -- Check if job should move to dead_letter
  IF v_attempts >= v_max_attempts THEN
    -- Move to dead_letter state
    UPDATE public.jobs
    SET state = 'dead_letter',
        attempts = v_attempts,
        last_error = p_error,  -- Keep text for backward compatibility (if column exists)
        error = v_error_payload,  -- Store structured error in jsonb column
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    -- Log dead_letter event
    INSERT INTO public.job_events (job_id, stage, data)
    VALUES (p_job_id, 'failed', jsonb_build_object(
      'stage', 'dead_letter',
      'reason', 'max_attempts_exceeded',
      'attempts', v_attempts,
      'max_attempts', v_max_attempts,
      'error', p_error
    ));

  ELSE
    -- Retry with backoff
    UPDATE public.jobs
    SET state = 'queued',
        attempts = v_attempts,
        last_error = p_error,  -- Keep text for backward compatibility (if column exists)
        error = v_error_payload,  -- Store structured error in jsonb column
        run_at = now() + (p_backoff_seconds || ' seconds')::interval,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    -- Log retry event
    INSERT INTO public.job_events (job_id, stage, data)
    VALUES (p_job_id, 'failed', jsonb_build_object(
      'stage', 'retry_scheduled',
      'attempts', v_attempts,
      'max_attempts', v_max_attempts,
      'backoff_seconds', p_backoff_seconds,
      'next_run_at', (now() + (p_backoff_seconds || ' seconds')::interval)::text,
      'error', p_error
    ));
  END IF;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.worker_fail(uuid, text, text, integer)
  TO anon, authenticated, service_role;

