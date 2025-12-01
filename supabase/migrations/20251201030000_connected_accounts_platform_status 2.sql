-- Task 1.4.A: Schema Alignment for connected_accounts
-- 1. Expand platform CHECK constraint to allow 'tiktok', 'youtube'
-- 2. Ensure status column exists with correct CHECK constraint ('active', 'revoked', 'error')

-- Drop old platform CHECK constraint
ALTER TABLE connected_accounts
DROP CONSTRAINT IF EXISTS connected_accounts_platform_check;

-- Add new platform CHECK constraint allowing 'tiktok' and 'youtube'
ALTER TABLE connected_accounts
ADD CONSTRAINT connected_accounts_platform_check
CHECK (platform IN ('tiktok', 'youtube'));

-- Add status column IF it doesn't exist (with default for new rows)
ALTER TABLE connected_accounts
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Update existing rows to 'active' if NULL (before applying constraints)
UPDATE connected_accounts
SET status = 'active'
WHERE status IS NULL;

-- Drop existing status CHECK constraint if it exists (may have different values like 'disabled')
ALTER TABLE connected_accounts
DROP CONSTRAINT IF EXISTS connected_accounts_status_check;

-- Update rows with invalid status values to 'active' (e.g., 'disabled' -> 'active')
UPDATE connected_accounts
SET status = 'active'
WHERE status NOT IN ('active', 'revoked', 'error');

-- Add status CHECK constraint with correct values
ALTER TABLE connected_accounts
ADD CONSTRAINT connected_accounts_status_check
CHECK (status IN ('active', 'revoked', 'error'));

-- Ensure NOT NULL constraint (in case column was just added)
ALTER TABLE connected_accounts
ALTER COLUMN status SET NOT NULL;

-- Ensure default is set for future inserts
ALTER TABLE connected_accounts
ALTER COLUMN status SET DEFAULT 'active';

