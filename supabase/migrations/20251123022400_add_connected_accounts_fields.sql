-- Add missing fields to connected_accounts for V1 API support
-- Adds display_name, handle, and status fields

ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS display_name text NULL,
  ADD COLUMN IF NOT EXISTS handle text NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'));

-- Add index for filtering by status
CREATE INDEX IF NOT EXISTS idx_connected_accounts_workspace_platform_status 
  ON connected_accounts(workspace_id, platform, status) 
  WHERE status = 'active';

-- Update existing rows to have status = 'active' if NULL (shouldn't happen but safe)
UPDATE connected_accounts SET status = 'active' WHERE status IS NULL;

