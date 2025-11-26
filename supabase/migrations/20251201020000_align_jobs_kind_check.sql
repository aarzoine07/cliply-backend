-- Align jobs.kind CHECK constraint with actual job kinds used in codebase
-- Current constraint is missing: PUBLISH_TIKTOK, YOUTUBE_DOWNLOAD
-- Current constraint includes: ANALYTICS_INGEST (not used in code)
-- This migration updates the constraint to match actual usage

DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_kind_check'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_kind_check;
  END IF;

  -- Re-create constraint with correct job kinds
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN (
      'TRANSCRIBE',
      'HIGHLIGHT_DETECT',
      'CLIP_RENDER',
      'THUMBNAIL_GEN',
      'YOUTUBE_DOWNLOAD',
      'PUBLISH_YOUTUBE',
      'PUBLISH_TIKTOK'
    ));
END $$;

