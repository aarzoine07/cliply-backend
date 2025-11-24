-- Add platform field to schedules table for multi-platform publishing support
-- This field is required for the cron scan endpoint to determine which job type to enqueue

-- Add platform column (nullable for backward compatibility with existing schedules)
ALTER TABLE "public"."schedules" 
ADD COLUMN IF NOT EXISTS "platform" text NULL;

-- Add check constraint to ensure platform is either 'tiktok' or 'youtube'
ALTER TABLE "public"."schedules" 
ADD CONSTRAINT "schedules_platform_check" 
CHECK (platform IS NULL OR platform IN ('tiktok', 'youtube'));

-- Create index for faster lookups by platform and status
CREATE INDEX IF NOT EXISTS "idx_schedules_platform_status" 
ON "public"."schedules" (platform, status) 
WHERE status = 'scheduled';

-- Add comment
COMMENT ON COLUMN "public"."schedules"."platform" IS 'Platform for which the schedule is intended: tiktok or youtube';

