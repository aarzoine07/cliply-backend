-- db/functions.sql

-- Atomic token bucket: consumes 1 token if available and returns remaining tokens (>=0).
-- If row doesn't exist, initializes with full capacity-1 consumption.
CREATE OR REPLACE FUNCTION public.refill_tokens(
  p_user_id uuid,
  p_route text,
  p_capacity integer,
  p_refill_per_min integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_row rate_limits%ROWTYPE;
  v_minutes numeric;
  v_add integer;
BEGIN
  INSERT INTO rate_limits (user_id, route, tokens, capacity, refill_per_min, last_refill)
  VALUES (p_user_id, p_route, p_capacity, p_capacity, p_refill_per_min, v_now)
  ON CONFLICT (user_id, route) DO NOTHING;

  SELECT * INTO v_row
  FROM rate_limits
  WHERE user_id = p_user_id AND route = p_route
  FOR UPDATE;

  v_minutes := EXTRACT(EPOCH FROM (v_now - v_row.last_refill)) / 60.0;
  v_add := FLOOR(v_minutes * p_refill_per_min);
  IF v_add > 0 THEN
    v_row.tokens := LEAST(v_row.capacity, v_row.tokens + v_add);
    v_row.last_refill := v_now;
  END IF;

  IF v_row.tokens > 0 THEN
    v_row.tokens := v_row.tokens - 1;
  END IF;

  UPDATE rate_limits
  SET tokens = v_row.tokens,
      last_refill = v_row.last_refill,
      capacity = p_capacity,
      refill_per_min = p_refill_per_min
  WHERE user_id = p_user_id AND route = p_route;

  RETURN v_row.tokens;
END;
$$;

-- Claim the next runnable job for a worker (queue worker loop).
-- Picks the oldest 'queued' job whose run_after <= now(), marks it 'running', sets worker_id & heartbeat.
CREATE OR REPLACE FUNCTION public.claim_job(p_worker_id uuid)
RETURNS jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_job jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM jobs
  WHERE status = 'queued' AND run_after <= now()
  ORDER BY run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE jobs
  SET status = 'running',
      worker_id = p_worker_id,
      last_heartbeat = now(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;
