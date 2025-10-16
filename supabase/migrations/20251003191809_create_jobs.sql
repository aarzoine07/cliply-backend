-- Create table: public.jobs
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,

  kind text NOT NULL
    CHECK (kind IN ('TRANSCRIBE','HIGHLIGHT_DETECT','CLIP_RENDER','PUBLISH_TIKTOK','ANALYTICS_INGEST')),

  priority int NOT NULL DEFAULT 5
    CHECK (priority BETWEEN 1 AND 9),

  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','done','error')),

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  last_error text,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance and job picking
CREATE INDEX idx_jobs_state_priority_runat ON public.jobs(state,priority,run_at);
CREATE INDEX idx_jobs_workspace_createdat ON public.jobs(workspace_id,created_at);
CREATE INDEX idx_jobs_lockedby ON public.jobs(locked_by);
CREATE INDEX idx_jobs_state_queued_partial ON public.jobs(id) WHERE state='queued';

-- Trigger to keep updated_at current
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.moddatetime();

-- Enable Row-Level Security (policies added later)
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
