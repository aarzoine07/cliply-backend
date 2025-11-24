-- C1: Add publish_config table for workspace-level publishing preferences (YouTube-first)
-- Stores per-workspace default settings for publishing to platforms

CREATE TABLE IF NOT EXISTS publish_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'twitter', 'facebook')),
  enabled boolean NOT NULL DEFAULT true,
  default_visibility text NOT NULL DEFAULT 'public' CHECK (default_visibility IN ('public', 'unlisted', 'private')),
  default_connected_account_ids uuid[] DEFAULT ARRAY[]::uuid[],
  title_template text NULL,
  description_template text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_publish_config_workspace ON publish_config(workspace_id);
CREATE INDEX IF NOT EXISTS idx_publish_config_platform ON publish_config(platform);

-- Add comment
COMMENT ON TABLE publish_config IS 'Per-workspace publishing configuration for each platform';
COMMENT ON COLUMN publish_config.default_connected_account_ids IS 'Array of connected account IDs to use for auto-publish when enabled';

