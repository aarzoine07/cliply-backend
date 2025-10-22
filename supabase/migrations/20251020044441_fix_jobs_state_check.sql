-- Safe, idempotent fix for jobs.status constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_status_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_status_check
      CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));
  ELSE
    RAISE NOTICE 'Constraint "jobs_status_check" already exists, skipping.';
  END IF;
END $$;
