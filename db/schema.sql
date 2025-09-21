-- db/schema.sql
-- Requires: extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== Organizations & Workspaces ==========
CREATE TABLE IF NOT EXISTS organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  owner_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  owner_id      uuid NOT NULL,
  org_id        uuid NULL REFERENCES organizations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_workspaces (
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (org_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_org_workspaces_org  ON org_workspaces(org_id);
CREATE INDEX IF NOT EXISTS idx_org_workspaces_ws   ON org_workspaces(workspace_id);

-- ========== Projects & Clips ==========
CREATE TABLE IF NOT EXISTS projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  source_type   text NOT NULL CHECK (source_type IN ('file','youtube')),
  source_path   text NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','error')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_ws     ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS clips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed','approved','rejected','rendering','ready','published','failed')),
  render_path   text NULL,
  duration_ms   integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clips_ws      ON clips(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clips_project ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_clips_status  ON clips(status);

-- ========== Scheduling ==========
CREATE TABLE IF NOT EXISTS schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  clip_id       uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  run_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','canceled','executed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_ws      ON schedules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_schedules_run_at  ON schedules(run_at);
CREATE INDEX IF NOT EXISTS idx_schedules_status  ON schedules(status);

-- ========== Connected Accounts (OAuth) ==========
CREATE TABLE IF NOT EXISTS connected_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  external_id   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ca_user_provider     ON connected_accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_ca_provider_external ON connected_accounts(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_ca_workspace         ON connected_accounts(workspace_id);

-- ========== Jobs (Queue) ==========
CREATE TABLE IF NOT EXISTS jobs (
  id             bigserial PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('TRANSCRIBE','HIGHLIGHT_DETECT','CLIP_RENDER','THUMBNAIL_GEN','PUBLISH_YOUTUBE','ANALYTICS_INGEST')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  run_after      timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 5,
  worker_id      uuid NULL,
  last_heartbeat timestamptz NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error          jsonb NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_ws               ON jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_jobs_kind             ON jobs(kind);

-- ========== Events ==========
CREATE TABLE IF NOT EXISTS events (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_ws_created ON events(workspace_id, created_at DESC);

-- ========== Rate Limits ==========
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id        uuid NOT NULL,
  route          text NOT NULL,
  tokens         integer NOT NULL DEFAULT 0,
  capacity       integer NOT NULL DEFAULT 60,
  refill_per_min integer NOT NULL DEFAULT 60,
  last_refill    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route)
);

-- ========== Idempotency ==========
CREATE TABLE IF NOT EXISTS idempotency (
  key           text PRIMARY KEY,
  user_id       uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending','completed','failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NULL,
  request_hash  text NULL,
  response_hash text NULL
);

-- ========== Products & Clip Links ==========
CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_ws ON products(workspace_id);

CREATE TABLE IF NOT EXISTS clip_products (
  clip_id     uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (clip_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_clip_products_clip    ON clip_products(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_products_product ON clip_products(product_id);
