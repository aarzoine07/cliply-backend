CREATE OR REPLACE FUNCTION auth.is_service_role() RETURNS boolean AS $$
  SELECT coalesce(current_setting('request.jwt.claims.role', true), '') = 'service_role';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.worker_claim_next_job(p_worker_id text)
RETURNS public.jobs AS $$
DECLARE
  v_job public.jobs;
BEGIN
  IF NOT auth.is_service_role() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.jobs
     SET state = 'running',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts = attempts + 1,
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = (
     SELECT id
       FROM public.jobs
      WHERE state = 'queued'
        AND run_at <= now()
        AND attempts < max_attempts
      ORDER BY priority ASC, run_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
     AND state = 'queued'
   RETURNING * INTO v_job;

  IF FOUND THEN
    INSERT INTO public.job_events(job_id, workspace_id, stage, data)
    VALUES (v_job.id, v_job.workspace_id, 'claimed', jsonb_build_object('worker', p_worker_id));
  END IF;

  RETURN v_job;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.worker_heartbeat(p_job_id uuid, p_worker_id text)
RETURNS void AS $$
BEGIN
  IF NOT auth.is_service_role() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.jobs
     SET heartbeat_at = now(),
         updated_at = now()
   WHERE id = p_job_id
     AND locked_by = p_worker_id
     AND state = 'running';
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.worker_finish(p_job_id uuid, p_worker_id text, p_result jsonb)
RETURNS void AS $$
DECLARE
  v_workspace uuid;
BEGIN
  IF NOT auth.is_service_role() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.jobs
     SET state = 'done',
         result = p_result,
         locked_at = NULL,
         locked_by = NULL,
         heartbeat_at = NULL,
         updated_at = now()
   WHERE id = p_job_id
     AND locked_by = p_worker_id
     AND state = 'running'
   RETURNING workspace_id INTO v_workspace;

  IF FOUND THEN
    INSERT INTO public.job_events(job_id, workspace_id, stage, data)
    VALUES (p_job_id, v_workspace, 'done', jsonb_build_object('status', 'ok'));
  END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.worker_fail(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_backoff_seconds int
)
RETURNS void AS $$
DECLARE
  v_workspace uuid;
  v_attempts int;
  v_max int;
  v_backoff int;
BEGIN
  IF NOT auth.is_service_role() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  v_backoff := coalesce(p_backoff_seconds, 0);

  SELECT workspace_id, attempts, max_attempts
    INTO v_workspace, v_attempts, v_max
    FROM public.jobs
   WHERE id = p_job_id
     AND locked_by = p_worker_id
     AND state = 'running'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_attempts < v_max THEN
    UPDATE public.jobs
       SET state = 'queued',
           run_at = now() + make_interval(secs => v_backoff),
           last_error = p_error,
           locked_at = NULL,
           locked_by = NULL,
           heartbeat_at = NULL,
           updated_at = now()
     WHERE id = p_job_id;

    INSERT INTO public.job_events(job_id, workspace_id, stage, data)
    VALUES (
      p_job_id,
      v_workspace,
      'retry_scheduled',
      jsonb_build_object('backoff_s', v_backoff, 'error', p_error)
    );
  ELSE
    UPDATE public.jobs
       SET state = 'error',
           last_error = p_error,
           locked_at = NULL,
           locked_by = NULL,
           heartbeat_at = NULL,
           updated_at = now()
     WHERE id = p_job_id;

    INSERT INTO public.job_events(job_id, workspace_id, stage, data)
    VALUES (
      p_job_id,
      v_workspace,
      'error',
      jsonb_build_object('message', p_error)
    );
  END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.worker_reclaim_stale(p_stale_seconds int DEFAULT 120)
RETURNS int AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF NOT auth.is_service_role() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  WITH reclaimed AS (
    UPDATE public.jobs
       SET state = 'queued',
           run_at = now() + interval '5 seconds',
           locked_at = NULL,
           locked_by = NULL,
           heartbeat_at = NULL,
           updated_at = now()
     WHERE state = 'running'
       AND heartbeat_at < now() - make_interval(secs => p_stale_seconds)
     RETURNING id, workspace_id
  )
  INSERT INTO public.job_events(job_id, workspace_id, stage)
  SELECT id, workspace_id, 'reclaimed'
    FROM reclaimed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN coalesce(v_count, 0);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;
