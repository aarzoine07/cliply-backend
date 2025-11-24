-- RPC function to atomically increment workspace usage
CREATE OR REPLACE FUNCTION increment_workspace_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_metric text,
  p_amount numeric
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO workspace_usage (workspace_id, period_start, source_minutes, clips_count, projects_count)
  VALUES (
    p_workspace_id,
    p_period_start,
    CASE WHEN p_metric = 'source_minutes' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'clips_count' THEN p_amount::integer ELSE 0 END,
    CASE WHEN p_metric = 'projects_count' THEN p_amount::integer ELSE 0 END
  )
  ON CONFLICT (workspace_id, period_start)
  DO UPDATE SET
    source_minutes = CASE
      WHEN p_metric = 'source_minutes' THEN workspace_usage.source_minutes + p_amount
      ELSE workspace_usage.source_minutes
    END,
    clips_count = CASE
      WHEN p_metric = 'clips_count' THEN workspace_usage.clips_count + p_amount::integer
      ELSE workspace_usage.clips_count
    END,
    projects_count = CASE
      WHEN p_metric = 'projects_count' THEN workspace_usage.projects_count + p_amount::integer
      ELSE workspace_usage.projects_count
    END,
    updated_at = now();
END;
$$;

