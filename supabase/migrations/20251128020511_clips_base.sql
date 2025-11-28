-- Base clips table required by viral experiments, publishing, and pipelines
-- Minimal version with correct foreign keys and constraints

CREATE TABLE IF NOT EXISTS public.clips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_url      text NOT NULL,
  start_ms        integer NOT NULL CHECK (start_ms >= 0),
  end_ms          integer NOT NULL CHECK (end_ms >= 0),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rendering', 'ready', 'failed')),
  caption_text    text,
  transcript_json jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- auto-update timestamp
CREATE TRIGGER trg_clips_updated_at
BEFORE UPDATE ON public.clips
FOR EACH ROW EXECUTE FUNCTION public.moddatetime();