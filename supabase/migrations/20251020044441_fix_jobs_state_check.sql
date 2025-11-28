-- 20251020044441_fix_jobs_state_check.sql
-- ------------------------------------------------------------------
-- This migration used to modify the jobs.status CHECK constraint
-- based on a previous "remote schema" layout where the jobs table
-- had a "status" column instead of "state".
--
-- The current Cliply backend uses the canonical jobs schema:
--   - "state" column: queued | processing | done | failed
--   - no "status" column
--
-- Trying to patch a non-existent "status" column causes
-- `supabase db reset` to fail with:
--   ERROR: column "status" does not exist
--
-- To keep the migration history consistent but avoid breaking local
-- resets, we intentionally turn this migration into a NO-OP.

DO $$
BEGIN
  RAISE NOTICE '20251020044441_fix_jobs_state_check: no-op under current schema';
END
$$;