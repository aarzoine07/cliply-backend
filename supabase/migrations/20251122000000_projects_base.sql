-- -----------------------------------------------------------
-- Cliply Base Projects Table (Clean Modern Version)
-- -----------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),

  -- belongs to a workspace
  workspace_id uuid not null
    references public.workspaces(id)
    on delete cascade,

  -- project title (required by backend + seed)
  title text not null,

  -- source (file upload, youtube, etc.)
  source_type text not null
    check (source_type in ('file', 'youtube')),

  -- file extension (e.g., mp4) - used by worker
  source_ext text,

  -- storage key of uploaded file (e.g., sample.mp4)
  source_key text,

  -- file key or YouTube URL
  source_uri text,

  -- processing lifecycle
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'error', 'uploaded')),

  -- optional: store error messages
  error jsonb,

  -- internal pipeline fields
  input_duration_seconds int,
  detected_language text,

  -- metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- keep updated_at fresh
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.moddatetime();

-- indexes
create index if not exists idx_projects_workspace_id
  on public.projects (workspace_id);

create index if not exists idx_projects_status
  on public.projects (status);