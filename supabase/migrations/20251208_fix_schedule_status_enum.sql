-- Drop old check constraint
ALTER TABLE public.schedules
  DROP CONSTRAINT IF EXISTS schedules_status_check;

-- Add updated lifecycle constraint
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_status_check
  CHECK (
    status IN (
      'scheduled',
      'claiming',
      'running',
      'done',
      'error',
      'canceled'
    )
  );