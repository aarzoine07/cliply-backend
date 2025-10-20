-- 🧩 Fix jobs_state_check constraint to include 'processing'
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_state_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_state_check
  CHECK (state IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));
