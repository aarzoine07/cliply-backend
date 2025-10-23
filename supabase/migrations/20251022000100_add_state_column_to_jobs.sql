-- 20251022000100_add_state_column_to_jobs.sql
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS state text
  CHECK (state IN ('queued', 'running', 'done', 'error'))
  DEFAULT 'queued'
  NOT NULL;
