-- ME-I-07: Align jobs table columns for DLQ & worker compatibility
-- This migration ensures public.jobs has the columns expected by:
--   - worker_claim_next_job RPC (run_at, locked_at, locked_by, heartbeat_at)
--   - worker_fail RPC (run_at, locked_at, locked_by)
--   - requeueDeadLetterJob helper (run_at, locked_at, locked_by)
--
-- This is a purely additive migration that:
--   - Adds missing columns with safe defaults
--   - Backfills run_at from run_after where applicable
--   - Does not drop or rename existing columns (run_after can remain)
--   - Is idempotent (safe to run multiple times)

DO $$
BEGIN
  -- Add run_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'jobs' 
      AND column_name = 'run_at'
  ) THEN
    ALTER TABLE public.jobs 
      ADD COLUMN run_at timestamptz DEFAULT now();
    
    -- Backfill run_at from run_after if that column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'jobs' 
        AND column_name = 'run_after'
    ) THEN
      UPDATE public.jobs 
      SET run_at = run_after 
      WHERE run_at IS NULL AND run_after IS NOT NULL;
    END IF;
    
    -- Also try backfilling from next_run_at if that exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'jobs' 
        AND column_name = 'next_run_at'
    ) THEN
      UPDATE public.jobs 
      SET run_at = next_run_at 
      WHERE run_at IS NULL AND next_run_at IS NOT NULL;
    END IF;
  END IF;

  -- Add locked_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'jobs' 
      AND column_name = 'locked_at'
  ) THEN
    ALTER TABLE public.jobs 
      ADD COLUMN locked_at timestamptz;
  END IF;

  -- Add locked_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'jobs' 
      AND column_name = 'locked_by'
  ) THEN
    ALTER TABLE public.jobs 
      ADD COLUMN locked_by text;
  END IF;

  -- Add heartbeat_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'jobs' 
      AND column_name = 'heartbeat_at'
  ) THEN
    ALTER TABLE public.jobs 
      ADD COLUMN heartbeat_at timestamptz;
  END IF;
END $$;

-- Add index on run_at for efficient worker polling (if run_at column exists)
-- This helps worker_claim_next_job RPC performance
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'jobs' 
      AND column_name = 'run_at'
  ) THEN
    -- Check if index already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND tablename = 'jobs' 
        AND indexname = 'idx_jobs_state_run_at'
    ) THEN
      CREATE INDEX idx_jobs_state_run_at 
        ON public.jobs (state, run_at) 
        WHERE state = 'queued';
    END IF;
  END IF;
END $$;

