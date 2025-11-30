-- Add pipeline_stage column to projects and clips tables
-- Tracks fine-grained Machine stages beyond DB status

-- Add to projects
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS pipeline_stage text;

-- Add to clips
ALTER TABLE public.clips
ADD COLUMN IF NOT EXISTS pipeline_stage text;

-- Optional indexes for filtering by stage
CREATE INDEX IF NOT EXISTS idx_projects_pipeline_stage
  ON public.projects (pipeline_stage)
  WHERE pipeline_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clips_pipeline_stage
  ON public.clips (pipeline_stage)
  WHERE pipeline_stage IS NOT NULL;

