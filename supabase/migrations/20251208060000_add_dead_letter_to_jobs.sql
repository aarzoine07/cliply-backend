-- ME-I-07: Add Dead-Letter Queue (DLQ) support to jobs table
-- This migration extends the jobs table to support dead_letter state
-- for jobs that have exceeded max_attempts and should stop retrying.

-- Extend job state CHECK constraint to include 'dead_letter'
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Find the existing state constraint (may have different names)
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%state%';

  -- Drop existing constraint if found
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END IF;

  -- Also try common constraint names
  ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_state_check;
  ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

  -- Re-create constraint with dead_letter state
  -- Include all known valid states from various migrations
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_state_check
    CHECK (state IN (
      'queued', 'pending',
      'processing', 'running',
      'done', 'completed', 'succeeded',
      'failed', 'error',
      'dead_letter'
    ));
EXCEPTION WHEN OTHERS THEN
  -- If constraint creation fails, log but don't fail migration
  RAISE NOTICE 'Could not create jobs_state_check constraint: %', SQLERRM;
END $$;

-- Ensure error jsonb column exists for structured error storage
-- (May already exist from previous migrations)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS error jsonb;

-- Add index for querying dead_letter jobs (optional, for admin queries)
CREATE INDEX IF NOT EXISTS idx_jobs_dead_letter
  ON public.jobs (state, updated_at)
  WHERE state = 'dead_letter';

