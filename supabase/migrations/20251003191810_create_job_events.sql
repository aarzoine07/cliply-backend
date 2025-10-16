CREATE TABLE public.job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  stage text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_job_events_jobid_createdat ON public.job_events(job_id, created_at);

-- Enable RLS (policies added later)
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
