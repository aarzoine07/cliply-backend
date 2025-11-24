-- C2: Add YouTube OAuth-specific fields to connected_accounts
-- Most fields already exist (access_token_encrypted_ref, refresh_token_encrypted_ref, expires_at, scopes)
-- This migration ensures all fields are present and adds any missing indexes

-- Add channel_id and channel_title if they don't exist (using external_id and display_name as fallback)
-- For YouTube, external_id will store channel_id and display_name will store channel_title
-- These columns already exist from previous migrations, so this is mainly for documentation

-- Ensure platform supports 'youtube' (already exists in schema)
-- The platform enum in code uses 'youtube' for connected accounts

-- Add index for faster lookups by platform and status
CREATE INDEX IF NOT EXISTS idx_connected_accounts_platform_status 
  ON connected_accounts(platform, status) 
  WHERE status = 'active';

-- Add index for token expiry lookups (for refresh jobs)
CREATE INDEX IF NOT EXISTS idx_connected_accounts_expires_at_active 
  ON connected_accounts(expires_at) 
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- Note: access_token_encrypted_ref, refresh_token_encrypted_ref, expires_at, scopes
-- already exist from previous migrations (20251020043717_remote_schema.sql)
-- external_id stores channel_id for YouTube
-- display_name stores channel_title for YouTube

