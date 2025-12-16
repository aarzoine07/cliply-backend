-- Drop the existing CHECK constraint on schedules.status
ALTER TABLE schedules
  DROP CONSTRAINT IF EXISTS schedules_status_check;
  