-- Viral Experiment Engine Tables
-- Supports A/B testing of clips with different captions, hashtags, sounds, thumbnails, etc.

-- Experiments table: top-level container for a set of variants
CREATE TABLE IF NOT EXISTS experiments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id    uuid NULL REFERENCES projects(id) ON DELETE SET NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
  goal_metric   text NOT NULL DEFAULT 'views' CHECK (goal_metric IN ('views', 'watch_time', 'likes', 'ctr', 'shares')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiments_workspace ON experiments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

-- Experiment variants: different configurations (caption A, caption B, etc.)
CREATE TABLE IF NOT EXISTS experiment_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  label         text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_variants_experiment ON experiment_variants(experiment_id);

-- Variant posts: represents one posting of a variant to a connected account
CREATE TABLE IF NOT EXISTS variant_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id          uuid NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  clip_id             uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('tiktok', 'youtube_shorts', 'instagram_reels')),
  platform_post_id    text NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'deleted', 'failed')),
  posted_at           timestamptz NULL,
  deleted_at          timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variant_posts_variant ON variant_posts(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_clip ON variant_posts(clip_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_account ON variant_posts(connected_account_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_variant_account ON variant_posts(variant_id, connected_account_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_status ON variant_posts(status);

-- Variant metrics: aggregated metrics snapshots for variant posts
CREATE TABLE IF NOT EXISTS variant_metrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_post_id   uuid NOT NULL REFERENCES variant_posts(id) ON DELETE CASCADE,
  views               integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  likes               integer NOT NULL DEFAULT 0 CHECK (likes >= 0),
  comments            integer NOT NULL DEFAULT 0 CHECK (comments >= 0),
  shares              integer NOT NULL DEFAULT 0 CHECK (shares >= 0),
  watch_time_seconds  bigint NOT NULL DEFAULT 0 CHECK (watch_time_seconds >= 0),
  ctr                 numeric NULL CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1)),
  snapshot_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variant_metrics_post ON variant_metrics(variant_post_id);
CREATE INDEX IF NOT EXISTS idx_variant_metrics_post_snapshot ON variant_metrics(variant_post_id, snapshot_at DESC);

-- Enable RLS
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_metrics ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY experiments_service_role_full_access
  ON experiments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY experiment_variants_service_role_full_access
  ON experiment_variants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY variant_posts_service_role_full_access
  ON variant_posts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY variant_metrics_service_role_full_access
  ON variant_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workspace members can read/write their workspace experiments
CREATE POLICY experiments_workspace_member_access
  ON experiments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = experiments.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = experiments.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY experiment_variants_workspace_member_access
  ON experiment_variants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM experiments e
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = experiment_variants.experiment_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM experiments e
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = experiment_variants.experiment_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY variant_posts_workspace_member_access
  ON variant_posts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM experiment_variants ev
      JOIN experiments e ON e.id = ev.experiment_id
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE ev.id = variant_posts.variant_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM experiment_variants ev
      JOIN experiments e ON e.id = ev.experiment_id
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE ev.id = variant_posts.variant_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY variant_metrics_workspace_member_access
  ON variant_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM variant_posts vp
      JOIN experiment_variants ev ON ev.id = vp.variant_id
      JOIN experiments e ON e.id = ev.experiment_id
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE vp.id = variant_metrics.variant_post_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variant_posts vp
      JOIN experiment_variants ev ON ev.id = vp.variant_id
      JOIN experiments e ON e.id = ev.experiment_id
      JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE vp.id = variant_metrics.variant_post_id
        AND wm.user_id = auth.uid()
    )
  );

-- Add updated_at trigger
CREATE TRIGGER trg_experiments_updated_at
  BEFORE UPDATE ON experiments
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER trg_experiment_variants_updated_at
  BEFORE UPDATE ON experiment_variants
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER trg_variant_posts_updated_at
  BEFORE UPDATE ON variant_posts
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');

