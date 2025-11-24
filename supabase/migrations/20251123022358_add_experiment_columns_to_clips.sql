-- Add experiment tracking columns to clips table
-- Links clips to experiment variants for viral A/B testing

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS experiment_id uuid NULL REFERENCES experiments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS experiment_variant_id uuid NULL REFERENCES experiment_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clips_experiment ON clips(experiment_id);
CREATE INDEX IF NOT EXISTS idx_clips_experiment_variant ON clips(experiment_variant_id);

-- RLS policies already cover clips table, so no additional policies needed
-- The experiment_id and experiment_variant_id columns inherit workspace scoping from clips.workspace_id

