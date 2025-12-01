-- Task 1.5.A: Align schedules schema and RLS
-- 1. Update status CHECK constraint: replace 'canceled' with 'failed'
-- 2. Ensure platform CHECK constraint exists (idempotent)
-- 3. Ensure status default is 'scheduled'

-- Update existing rows with 'canceled' status to 'failed' to match new constraint
UPDATE schedules
SET status = 'failed'
WHERE status = 'canceled';

-- Drop existing status CHECK constraint
ALTER TABLE schedules
DROP CONSTRAINT IF EXISTS schedules_status_check;

-- Add new status CHECK constraint with 'scheduled', 'executed', 'failed'
ALTER TABLE schedules
ADD CONSTRAINT schedules_status_check
CHECK (status IN ('scheduled', 'executed', 'failed'));

-- Ensure status default is 'scheduled' (idempotent)
ALTER TABLE schedules
ALTER COLUMN status SET DEFAULT 'scheduled';

-- Ensure platform CHECK constraint exists (idempotent)
-- Drop and recreate to ensure it matches spec
ALTER TABLE schedules
DROP CONSTRAINT IF EXISTS schedules_platform_check;

ALTER TABLE schedules
ADD CONSTRAINT schedules_platform_check
CHECK (platform IS NULL OR platform IN ('tiktok', 'youtube'));

