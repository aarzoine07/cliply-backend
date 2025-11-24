Cliply V1 – Backend Product & System Spec
1. What Cliply Is

Cliply is an AI-powered clipping and publishing platform for creators.

Core promise

For creators who have long-form content (YouTube videos, podcasts, streams), Cliply:

Finds the best moments in their long videos.

Turns them into short clips ready for TikTok / YouTube Shorts.

Posts them automatically to multiple channels/accounts.

Runs viral experiments (different hooks, captions, hashtags, thumbnails, accounts).

Learns what works so creators can get more views with less effort.

Target users (V1)

Solo creators or small teams with:

1–5 YouTube channels.

1–5 TikTok accounts.

They already have content but don’t want to:

Manually edit clips.

Manually post across multiple accounts.

Guess which hooks/captions perform best.

2. V1 Scope – What’s In vs. Later
In Scope for V1 (must work end-to-end)

Upload & ingest

Upload long videos (file upload).

Import long videos via YouTube URL.

Store video in Supabase Storage as the “source” file.

Processing pipeline

Transcription.

Highlight detection (find candidate clips).

Clip rendering (cut the source into clips).

Thumbnail generation.

Queue-based execution via worker.

Clip management

Store clips in DB with timestamps, metadata, and URLs.

Allow selection of clips for publishing.

Multi-account publishing

Connect multiple YouTube channels.

Connect multiple TikTok accounts.

Publish clips to 1 or many connected accounts per platform.

Viral experiment engine (foundation)

Experiments, variants, variant_posts, metrics tables.

Attach clips to experiment variants.

Track which variant was posted to which account.

Provide APIs to push metrics back into the system.

Usage limits & plans

Per-workspace plan limits:

Monthly source_minutes.

Monthly clips.

Monthly projects.

Enforce limits at API boundaries and inside pipelines.

Connected accounts & publish config

APIs to manage connected accounts.

APIs to manage default publishing configuration (visibility, default accounts, etc.).

YouTube OAuth & token management

OAuth flow for Google/YouTube.

Store & refresh tokens.

Use fresh tokens in YouTube publish worker.

Core security & reliability

Authenticated, workspace-scoped APIs.

Rate limiting and usage enforcement.

Logging, basic error handling, and safe failures.

Out of Scope / Later (V1.5+)

Instagram integration.

Advanced editing timeline UI.

Auto-delete / auto-repost logic for underperforming posts.

Full analytics fetchers for all platforms (continuous syncing).

Advanced monetization logic (e.g., revenue attribution).

Physical product (dropshipping) features.

Fully automated pricing/billing (can be manual plan assignment in admin at first).

3. High-Level Architecture
Components

Web App (Next.js / React) – apps/web

Provides the creator-facing dashboard.

Hosts all API routes (under /api/...) used by the frontend and sometimes worker.

Talks to Supabase (DB + Storage) and shared libraries.

Worker – apps/worker

Listens to job queue (Supabase or similar).

Runs all heavy pipelines:

YOUTUBE_DOWNLOAD

TRANSCRIBE

HIGHLIGHT_DETECT

CLIP_RENDER

THUMBNAIL_GEN

PUBLISH_YOUTUBE

(Future: PUBLISH_TIKTOK, analytics fetchers, etc.)

Shared package – packages/shared

Shared domain logic and types:

Zod schemas (jobs, env, viral, usage, etc.).

Billing/usage logic.

Constants.

Logging.

YouTube OAuth helpers.

Supabase

Postgres – main database.

Storage – stores source videos, rendered clips, thumbnails.

Auth is NOT primary (we assume NextAuth or similar in web app) but DB is workspace-scoped.

External services

YouTube API – upload shorts, fetch channel info, etc.

TikTok API – for publishing (V1 implementation TBD, but planned).

FFmpeg – used by worker to generate clips and thumbnails.

Transcription model – could be OpenAI/Whisper or other.

4. Domain Model (Core Entities)
Workspaces & Users

workspace

id

name

plan_name (e.g. free, starter, pro)

current_usage (denormalized counters)

user

id

email

name

workspace_users

workspace_id

user_id

role (owner, member)

Projects & Clips

projects

id

workspace_id

title

source_type (file | youtube)

source_path (storage path or original URL)

status (queued, processing, clips_ready, failed)

duration_seconds (once known)

created_at, updated_at

clips

id

workspace_id

project_id

start_sec, end_sec

duration_sec

title / hook

caption_suggestion

thumbnail_path (storage path)

status (ready, published, archived)

experiment_id (nullable; for viral engine)

experiment_variant_id (nullable)

created_at, updated_at

Jobs & Pipelines

jobs (or similar job table)

id

type (YOUTUBE_DOWNLOAD, TRANSCRIBE, HIGHLIGHT_DETECT, CLIP_RENDER, THUMBNAIL_GEN, PUBLISH_YOUTUBE, etc.)

payload (JSON)

status

attempts

last_error

created_at, updated_at

Connected Accounts & Publishing

connected_accounts

id

workspace_id

platform (youtube, tiktok)

platform_account_id (channel ID / TikTok ID)

display_name

access_token_encrypted_ref

refresh_token_encrypted_ref

expires_at

scopes

status (active, disconnected, error)

created_at, updated_at

publish_config

workspace_id

default_visibility (per platform – e.g. YouTube: public/unlisted, TikTok: public)

enabled (boolean)

default_account_ids (array of connected_account ids)

title_template (string with placeholders)

description_template (string with placeholders)

created_at, updated_at

Viral Experiments

experiments

id

workspace_id

project_id (optional)

name

status (draft, running, completed, cancelled)

goal_metric (views, watch_time, likes, ctr, shares)

created_at, updated_at

experiment_variants

id

experiment_id

label (e.g. “A”, “B”)

config (JSONB; e.g. { caption, hashtags, sound, thumbnail_style, posting_schedule })

created_at, updated_at

variant_posts

id

variant_id

clip_id

connected_account_id

platform (youtube, tiktok)

platform_post_id (video ID)

status (pending, posted, deleted, failed)

posted_at

created_at, updated_at

variant_metrics

id

variant_post_id

views

likes

comments

shares

watch_time_seconds

ctr

snapshot_at (timestamp)

created_at

Usage & Plans

usage_events (or usage table)

id

workspace_id

metric (source_minutes, clips, projects)

quantity (numeric)

period_start, period_end (for month)

created_at

plan_matrix (in code, not necessarily DB)

configuration of plan limits per metric.

5. Core Backend Flows (Mapped to APIs & Pipelines)
5.1 New Creator Onboarding

Goal: Workspace + at least one connected account + publish config.

APIs & behavior:

/api/workspace/init (or similar)

Creates workspace when user signs in first time.

Assigns default plan (e.g. starter).

/api/accounts (Connected Accounts API)

GET /api/accounts – list connected accounts for workspace.

POST /api/accounts – create or update a connected account.

PATCH /api/accounts/[id] – update account status.

/api/accounts/publish

GET – returns:

connected accounts

publish_config for workspace.

PATCH – updates publish_config:

Validate account IDs.

Validate visibility options.

Worker involvement: none here, purely web app + DB.

5.2 Uploading a Long Video (File or YouTube)

Goal: Create project, store source, enqueue pipeline.

APIs & pipelines:

POST /api/upload/init

Input:

source: "file" or "youtube".

For file: file metadata (name, size, mime).

For YouTube: url.

Behavior:

Runs usage check:

Enough projects and source_minutes quota to start.

Creates project row.

For file:

Generates signed upload URL.

Returns { uploadUrl, projectId }.

For youtube:

Sets source_type="youtube", source_path=youtubeUrl.

Enqueues YOUTUBE_DOWNLOAD job with { projectId, youtubeUrl }.

Returns { projectId }.

Worker pipelines:

YOUTUBE_DOWNLOAD:

Validates URL.

Downloads video via service abstraction (currently stubbed; eventually yt-dlp).

Uploads to storage in bucket videos/{workspaceId}/{projectId}/source.mp4.

Updates project source_path to storage path.

Enqueues TRANSCRIBE.

TRANSCRIBE:

Checks usage (source_minutes).

Transcribes audio.

Writes transcription + sets project duration_seconds.

Records usage event.

HIGHLIGHT_DETECT:

Checks clips usage.

Generates candidate clips with start/end, score, titles/captions.

Writes clips records.

Records clips usage.

CLIP_RENDER:

For each clip:

Uses FFmpeg to cut source video.

Saves rendered clip to storage.

Updates clips with file_path.

THUMBNAIL_GEN:

Picks frames from clips.

Generates thumbnail image(s).

Saves thumbnail_path.

End state: project.status = "clips_ready", with associated clips records.

5.3 Clip Review & Selection

Goal: Let the frontend show and manage clips.

Backend behavior:

GET /api/projects/[id]/clips (or similar)

Returns:

Project info.

List of clips with metadata:

Start/end, duration.

Caption suggestion.

Thumbnail URL.

Status (ready, published, etc.).

Experiment data (if any).

PATCH /api/clips/[id]

Allows:

Updating caption text.

Changing status (ready, archived).

(Optional) marking clip as “selected_for_publishing”.

Worker: no heavy work here; mostly DB updates and reads.

5.4 Viral Experiments

Goal: Support A/B testing of captions/hashtags/etc. across accounts.

APIs & backend logic:

POST /api/viral/experiments

Input:

name

goal_metric

project_id (optional, but typical)

variants: array of { label, config (JSON) }

Behavior:

Creates experiments row.

Bulk inserts experiment_variants.

GET /api/viral/experiments

Returns list of experiments and variants for workspace.

Possibly filtered by project.

Attaching clips to variants:

attachClipToExperimentVariant(clipId, experimentId, variantId)

Sets clips.experiment_id and clips.experiment_variant_id.

Creating variant_posts:

createVariantPostsForClip(clipId, variantId, platform, connectedAccountIds?)

Creates a variant_post row per account.

Sets status=pending, avoids duplicates (idempotent).

Metrics:

POST /api/viral/metrics

Input:

variant_post_id

views, likes, comments, shares, watch_time_seconds, ctr (any subset).

Behavior:

Inserts metrics snapshot into variant_metrics.

Worker hooks (current & future):

When publishing (YouTube/TikTok):

Use experiment/variant context (from job payload) to:

Set appropriate caption/hashtags/thumbnails.

Call updateVariantPostAfterPublish() to mark posted and store platform_post_id.

5.5 Multi-Account Publishing (YouTube + TikTok)

Goal: From a single clip, publish to many accounts/platforms.

APIs:

POST /api/publish/youtube

Input:

clipId

visibility

Optional:

experimentId

variantId

connectedAccountIds (specific subset), OR

none → use defaults from publish_config.

Behavior:

Resolve workspace and clip.

Determine target accounts (from input or defaults).

If experimentId / variantId given:

Attach clip to experiment variant.

Call createVariantPostsForClip to create variant_posts.

For each target account:

Enqueue PUBLISH_YOUTUBE job with:

clipId

connectedAccountId

experimentId/variantId (optional)

visibility

Return job summary.

POST /api/publish/tiktok (planned V1)

Same pattern as YouTube, but:

Platform tiktok.

Target accounts = TikTok accounts.

Worker:

PUBLISH_YOUTUBE pipeline:

Given job:

Fetch clip storage path.

Fetch workspace’s connected account + tokens.

Get access token via getFreshYouTubeAccessToken.

Upload clip to YouTube Shorts:

Title/caption from variant config or clip caption.

Channel from connected account.

On success:

Update variant_posts (if exists) via updateVariantPostAfterPublish().

Set platform_post_id to video ID.

On failure:

Mark job failed.

Mark variant_post failed if relevant.

PUBLISH_TIKTOK pipeline (to be implemented similarly).

5.6 Usage & Rate Limiting

Goal: Prevent abuse and keep pricing predictable.

Key module: packages/shared/billing/usageTracker.ts + planMatrix.ts.

Behavior:

Before creating project / upload:

/api/upload/init calls assertWithinUsage:

Check:

projects monthly limit.

Rough source_minutes budget (based on file length hint if available; if not, conservative estimate or allow and enforce later).

If over limit → return 429 Too Many Requests with structured error.

Inside pipelines:

TRANSCRIBE:

Before work: check at least 1 minute remaining.

After work: record actual source_minutes usage (rounded up).

HIGHLIGHT_DETECT:

Before work: check approximate clips quota.

After work: record number of new clips created.

Usage API:

/api/usage:

Returns:

plan info.

Used/remaining per metric.

Period (current month).

Design:

All usage is per-workspace, per calendar month.

Plan limits can be null for “unlimited” metrics.

5.7 Security, Auth, and Multi-Tenancy

Goals:

Only authenticated users can call private APIs.

Every API is scoped to the caller’s workspace.

Prevent cross-workspace data leaks.

Key pieces:

Auth resolution

Each API route uses a helper like resolveAuth(req):

Returns { userId, workspaceId } or throws a 401 if not logged in.

For tests, there is a test harness that injects a fake user/workspace.

Workspace scoping

Every DB query includes workspace_id = currentWorkspaceId.

connected_accounts, projects, clips, experiments, variant_posts, etc. are all workspace-owned.

Secrets

No tokens stored raw in DB.

Access & refresh tokens are stored via *_encrypted_ref fields (pointing to encrypted storage/secret manager).

env.ts centralizes required environment variables; app fails fast if missing.

Rate limiting & abuse

Simple per-route rate limits on hot endpoints (/api/upload/init, /api/publish/...).

Usage limits also serve as a soft guard against abuse.

CORS / CSRF

API is first-party (same origin as frontend).

For session-based auth, use CSRF protection where needed (e.g. for POST routes).

For token-based auth, ensure tokens are scoped and revocable.

6. Observability & Operations
Logging

Use centralized logger (in packages/shared/logging):

Structured logs with:

service (api / worker).

workspaceId, userId (when known).

jobId for worker logs.

Key events:

upload_init_start / upload_init_success / errors.

Pipeline steps (transcribe_start, transcribe_success, etc.).

Publish events per platform/account.

Usage checks (limit exceeded).

Error handling

API:

Custom HttpError class with status, code, message.

Catch errors in API handlers and return JSON error shapes consistently.

Worker:

Jobs that throw:

Mark jobs.status = failed.

Keep last_error message.

Optionally schedule retries with backoff.

Health & readiness (later)

/api/readyz and /api/healthz endpoints could:

Check DB connectivity.

Check queue connectivity.

Check storage connectivity.

7. “Backend Is Ready” Definition (Production & Onboarding)

The backend is 100% production & onboarding ready when:

Core flows work end-to-end

User can:

Sign up → workspace created.

Connect YouTube channel and TikTok account.

Upload a long video (file or YouTube URL).

Wait for clips to be generated.

Review clips (preview, edit captions).

Publish clips to multiple YouTube/TikTok accounts.

(Optionally) set up a simple experiment with variants and see variant-level postings.

Usage & plans are enforced

If a workspace exceeds source_minutes or clips:

Uploads are blocked with clear errors.

Pipelines will not run beyond the limits.

Viral experiment foundation is in place

Experiments, variants, variant_posts, variant_metrics tables exist and work.

Posting with experiment context creates variant_posts.

Metrics can be recorded and queried.

Security & isolation

All APIs require auth and are workspace-scoped.

Connected accounts and tokens are never cross-visible between workspaces.

Reliability basics

Job queue processes jobs successfully most of the time.

Failures are logged clearly with enough context to debug.

pnpm test and pnpm typecheck pass.