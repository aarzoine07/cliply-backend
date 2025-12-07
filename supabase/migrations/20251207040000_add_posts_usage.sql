-- ME-I-04: Add posts_count to workspace_usage for tracking published clips
-- This migration extends the usage tracking system to meter posts (published clips)
-- across TikTok, YouTube, and other platforms.

-- Add posts_count column to workspace_usage
ALTER TABLE workspace_usage
ADD COLUMN IF NOT EXISTS posts_count integer NOT NULL DEFAULT 0 CHECK (posts_count >= 0);

-- Update increment_workspace_usage RPC to handle 'posts' metric
CREATE OR REPLACE FUNCTION increment_workspace_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_metric text,
  p_amount numeric
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO workspace_usage (workspace_id, period_start, source_minutes, clips_count, projects_count, posts_count)
  VALUES (
    p_workspace_id,
    p_period_start,
    CASE WHEN p_metric = 'source_minutes' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'clips_count' THEN p_amount::integer ELSE 0 END,
    CASE WHEN p_metric = 'projects_count' THEN p_amount::integer ELSE 0 END,
    CASE WHEN p_metric = 'posts_count' THEN p_amount::integer ELSE 0 END
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
    posts_count = CASE
      WHEN p_metric = 'posts_count' THEN workspace_usage.posts_count + p_amount::integer
      ELSE workspace_usage.posts_count
    END,
    updated_at = now();
END;
$$;

