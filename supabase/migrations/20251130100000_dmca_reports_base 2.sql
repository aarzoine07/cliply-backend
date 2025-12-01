-- Base table for DMCA reports
-- Derived from snapshot, expanded with proper constraints, indexes, and RLS.
-- Later migrations may add policies or helper logic.

CREATE TABLE IF NOT EXISTS public.dmca_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  reporter_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  clip_id       uuid REFERENCES public.clips(id) ON DELETE SET NULL,
  reason        text,
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (policies added later)
ALTER TABLE public.dmca_reports
  ENABLE ROW LEVEL SECURITY;

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_dmca_reports_workspace
  ON public.dmca_reports(workspace_id);

CREATE INDEX IF NOT EXISTS idx_dmca_reports_clip
  ON public.dmca_reports(clip_id);

CREATE INDEX IF NOT EXISTS idx_dmca_reports_status
  ON public.dmca_reports(status);

-- Auto-update updated_at
CREATE TRIGGER trg_dmca_reports_updated_at
  BEFORE UPDATE ON public.dmca_reports
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');