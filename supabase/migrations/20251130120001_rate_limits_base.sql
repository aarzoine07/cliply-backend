-- Base table for rate limits
-- Derived from snapshot, with primary key, foreign keys, indexes, and RLS.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route          text NOT NULL,
  tokens         integer NOT NULL DEFAULT 0,
  capacity       integer NOT NULL DEFAULT 60,
  refill_per_min integer NOT NULL DEFAULT 60,
  last_refill    timestamptz NOT NULL DEFAULT now(),
  workspace_id   uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, route)
);

-- Enable RLS (policies may be added/adjusted by later migrations)
ALTER TABLE public.rate_limits
  ENABLE ROW LEVEL SECURITY;

-- Index for workspace-scoped rate limit checks
CREATE INDEX IF NOT EXISTS idx_rate_limits_workspace
  ON public.rate_limits(workspace_id);