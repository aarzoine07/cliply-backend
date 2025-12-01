-- Base table for events audit logging
-- Derived from snapshot, with correct foreign keys, indexes, and RLS setup.

CREATE TABLE IF NOT EXISTS public.events_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    text NOT NULL,
  target_id     uuid,  -- intentionally no FK (generic)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (policies added later)
ALTER TABLE public.events_audit
  ENABLE ROW LEVEL SECURITY;

-- Useful indexes for querying audit logs
CREATE INDEX IF NOT EXISTS idx_events_audit_workspace
  ON public.events_audit(workspace_id);

CREATE INDEX IF NOT EXISTS idx_events_audit_event_type
  ON public.events_audit(event_type);

CREATE INDEX IF NOT EXISTS idx_events_audit_created_at
  ON public.events_audit(created_at);
