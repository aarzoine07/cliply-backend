-- Base table for schedules
-- Derived from remote schema and expanded with necessary constraints.
-- Later migrations may extend this table (e.g., adding platform).

CREATE TABLE IF NOT EXISTS public.schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clip_id       uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  run_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS at base
ALTER TABLE public.schedules
  ENABLE ROW LEVEL SECURITY;

-- Essential indexes for cron & workspace scans
CREATE INDEX IF NOT EXISTS idx_schedules_workspace
  ON public.schedules(workspace_id);

CREATE INDEX IF NOT EXISTS idx_schedules_run_at
  ON public.schedules(run_at);

CREATE INDEX IF NOT EXISTS idx_schedules_status
  ON public.schedules(status);

-- Auto-update timestamp trigger
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');
