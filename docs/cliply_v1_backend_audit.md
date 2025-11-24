# Cliply V1 Backend Audit Report

**Date:** 2025-01-XX  
**Auditor:** Senior Backend Lead  
**Scope:** Full V1 backend spec compliance audit

---

## Executive Summary

This audit compares the current implementation against `docs/cliply_v1_backend_spec.md` to identify what is **DONE**, **PARTIAL**, and **MISSING** for V1 production readiness.

---

## A) Ingest & Pipelines

### Upload/init API (file + YouTube)

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/upload/init.ts`

**Notes:**
- Supports both file upload and YouTube URL import
- Usage limits enforced before project creation (projects, source_minutes)
- File upload: generates signed upload URL, creates project with `status='queued'`
- YouTube: creates project, enqueues `YOUTUBE_DOWNLOAD` job
- Rate limiting implemented
- Usage tracking records project creation

### YOUTUBE_DOWNLOAD Pipeline

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/youtube-download.ts`
- `apps/worker/src/services/youtube/download.ts`

**Notes:**
- Validates YouTube URL and extracts video ID
- Downloads video using yt-dlp abstraction
- Uploads to Supabase Storage (`videos/{workspaceId}/{projectId}/source.mp4`)
- Updates project `source_path` and `status='processing'`
- Enqueues `TRANSCRIBE` job on success
- Idempotent (skips if video already exists)

### TRANSCRIBE Pipeline

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/transcribe.ts`
- `apps/worker/src/services/transcriber/`

**Notes:**
- Checks usage limits (`source_minutes`) before processing
- Downloads source video from storage
- Transcribes using Deepgram/Whisper abstraction
- Stores transcript as SRT and JSON in `transcripts` bucket
- Records actual `source_minutes` usage after transcription
- Updates project `status='transcribed'`
- Enqueues `HIGHLIGHT_DETECT` job

### HIGHLIGHT_DETECT Pipeline

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/highlight-detect.ts`

**Notes:**
- Checks usage limits (`clips`) before processing
- Reads transcript JSON from storage
- Groups segments by gap threshold
- Generates candidate clips with scoring (keywords, confidence)
- Creates `clips` records with `status='proposed'`
- Records `clips` usage
- Updates project `status='clips_proposed'`
- Does NOT automatically enqueue `CLIP_RENDER` (manual trigger or separate flow)

### CLIP_RENDER Pipeline

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/clip-render.ts`
- `apps/worker/src/services/ffmpeg/`

**Notes:**
- Downloads source video and optional subtitles
- Uses FFmpeg to cut clip segment
- Generates thumbnail during render (at midpoint)
- Uploads rendered clip to `renders` bucket
- Uploads thumbnail to `thumbs` bucket
- Updates clip `status='ready'`, `storage_path`, `thumb_path`
- Idempotent (skips if already rendered)

### THUMBNAIL_GEN Pipeline

**Status:** DONE (but potentially redundant)  
**Files:**
- `apps/worker/src/pipelines/thumbnail.ts`

**Notes:**
- Standalone thumbnail generation pipeline
- Can generate thumbnail from rendered clip or source video
- **Note:** `CLIP_RENDER` already generates thumbnails, so this may be for regeneration/override use cases
- Updates clip `thumb_path`

### End-to-End: project -> clips_ready

**Status:** PARTIAL  
**Files:**
- Pipeline files listed above
- `apps/worker/src/worker.ts` (orchestration)

**Notes:**
- **Gap:** Pipeline orchestration is manual/event-driven
  - `YOUTUBE_DOWNLOAD` → `TRANSCRIBE` ✅ (automatic)
  - `TRANSCRIBE` → `HIGHLIGHT_DETECT` ✅ (automatic)
  - `HIGHLIGHT_DETECT` → `CLIP_RENDER` ❌ (NOT automatic)
- Clips are created with `status='proposed'` but not automatically rendered
- Spec requires `project.status='clips_ready'` when clips are ready; current status is `'clips_proposed'`
- **Missing:** Automatic enqueue of `CLIP_RENDER` jobs for all proposed clips, or batch render trigger
- **Missing:** Final status transition to `'clips_ready'` after all clips are rendered

---

## B) Multi-Account & Connected Accounts

### connected_accounts Models + APIs

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/accounts/index.ts`
- `apps/web/src/lib/accounts/connectedAccountsService.ts`
- `supabase/migrations/20251123022400_add_connected_accounts_fields.sql`

**Notes:**
- Table exists with fields: `platform`, `external_id`, `display_name`, `access_token_encrypted_ref`, `refresh_token_encrypted_ref`, `expires_at`, `scopes`, `status`
- GET `/api/accounts` - list accounts (filterable by platform)
- POST `/api/accounts` - create/update account
- Service layer handles workspace scoping
- Supports `youtube` and `tiktok` platforms

### publish_config Models + APIs

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/accounts/publish.ts`
- `apps/web/src/lib/accounts/publishConfigService.ts`
- `supabase/migrations/20251124000000_add_publish_config.sql`

**Notes:**
- Table exists with fields: `workspace_id`, `platform`, `enabled`, `default_visibility`, `default_connected_account_ids[]`, `title_template`, `description_template`
- GET `/api/accounts/publish` - returns connected accounts + publish config
- PATCH `/api/accounts/publish` - updates publish config
- Validates that `default_connected_account_ids` belong to workspace and platform

### Ability to Publish to Multiple YouTube/TikTok Accounts

**Status:** PARTIAL  
**Files:**
- `apps/web/src/pages/api/publish/youtube.ts`
- `apps/worker/src/pipelines/publish-youtube.ts`

**Notes:**
- **YouTube:** ✅ Supports multiple accounts
  - `/api/publish/youtube` accepts `connectedAccountIds[]` or uses defaults from `publish_config`
  - Resolves accounts via `getConnectedAccountsForPublish()`
  - Creates one `PUBLISH_YOUTUBE` job per account (or single job with `connectedAccountIds[]` in payload)
  - **Gap:** Current `PUBLISH_YOUTUBE` pipeline only handles single account (uses first `connectedAccountId` from payload)
  - **Missing:** Loop in pipeline to publish to all accounts in `connectedAccountIds[]`
- **TikTok:** ❌ Not implemented
  - No `/api/publish/tiktok` endpoint
  - `PUBLISH_TIKTOK` pipeline is stub only

---

## C) Viral Experiment Engine

### experiments, experiment_variants, variant_posts, variant_metrics Tables/Migrations

**Status:** DONE  
**Files:**
- `supabase/migrations/20251123021611_viral_experiments.sql`
- `supabase/migrations/20251123022358_add_experiment_columns_to_clips.sql`

**Notes:**
- All tables exist with correct schema
- `experiments`: workspace_id, project_id, name, status, goal_metric
- `experiment_variants`: experiment_id, label, config (JSONB)
- `variant_posts`: variant_id, clip_id, connected_account_id, platform, platform_post_id, status
- `variant_metrics`: variant_post_id, views, likes, comments, shares, watch_time_seconds, ctr, snapshot_at
- `clips` table has `experiment_id` and `experiment_variant_id` columns
- RLS policies in place for workspace isolation

### APIs for Creating Experiments, Recording Metrics

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/viral/experiments.ts`
- `apps/web/src/pages/api/viral/metrics.ts`
- `apps/web/src/lib/viral/experimentService.ts`
- `apps/web/src/lib/viral/metricsService.ts`

**Notes:**
- POST `/api/viral/experiments` - creates experiment with variants
- GET `/api/viral/experiments` - lists experiments for workspace
- POST `/api/viral/metrics` - records metrics snapshot for variant_post
- `attachClipToExperimentVariant()` - attaches clip to variant
- All APIs are workspace-scoped

### Integration with Publishing (variant_posts Creation + Update on Publish)

**Status:** PARTIAL  
**Files:**
- `apps/web/src/pages/api/publish/youtube.ts`
- `apps/web/src/lib/viral/orchestrationService.ts`
- `apps/worker/src/services/viral/variantPosts.ts`

**Notes:**
- **Creation:** ✅ DONE
  - `/api/publish/youtube` calls `createVariantPostsForClip()` when `experimentId`/`variantId` provided
  - Creates `variant_posts` for all target connected accounts
  - Idempotent (skips existing posts)
- **Update on Publish:** ✅ DONE
  - `PUBLISH_YOUTUBE` pipeline calls `updateVariantPostAfterPublish()`
  - Updates `variant_posts.status='posted'`, sets `platform_post_id`
- **Gap:** Only works for YouTube; TikTok publishing not implemented
- **Gap:** Variant config (caption, hashtags) not yet applied during publish (pipeline uses clip caption, not variant config)

---

## D) Usage & Plan Limits

### planMatrix / usageTracker Logic

**Status:** DONE  
**Files:**
- `packages/shared/billing/usageTracker.ts`
- `packages/shared/billing/planMatrix.ts`
- `supabase/migrations/20251123000000_workspace_usage.sql`
- `supabase/migrations/20251123000001_increment_workspace_usage_rpc.sql`

**Notes:**
- `workspace_usage` table tracks `source_minutes`, `clips_count`, `projects_count` per workspace per month
- `PLAN_MATRIX` defines limits per plan (basic, pro, premium)
- `recordUsage()` - atomically increments usage
- `getUsageSummary()` - returns current period usage vs limits
- `assertWithinUsage()` - throws `UsageLimitExceededError` if limit exceeded
- Workspace plan stored in `workspaces.plan` column

### Enforcement at /api/upload/init

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/upload/init.ts` (lines 73-97, 163-187)

**Notes:**
- Checks `projects` limit before creating project
- Checks `source_minutes` limit (estimated from file size or conservative default for YouTube)
- Returns 429 with structured error if limit exceeded
- Records `projects` usage after successful creation

### Enforcement Inside Pipelines (transcribe, highlight-detect)

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/transcribe.ts` (lines 23-39)
- `apps/worker/src/pipelines/highlight-detect.ts` (lines 37-54)

**Notes:**
- `TRANSCRIBE`: Checks `source_minutes` limit (at least 1 minute) before heavy work
- `TRANSCRIBE`: Records actual `source_minutes` usage after transcription
- `HIGHLIGHT_DETECT`: Checks `clips` limit before processing
- `HIGHLIGHT_DETECT`: Records `clips` usage after creating clips
- Both throw `UsageLimitExceededError` which marks job as failed

### /api/usage Endpoint

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/usage.ts`

**Notes:**
- GET `/api/usage` - returns plan info, period, and used/remaining per metric
- Uses `getUsageSummary()` from usageTracker
- Workspace-scoped

---

## E) YouTube OAuth & Publishing

### OAuth Flows and Token Storage for YouTube

**Status:** DONE  
**Files:**
- `apps/web/src/pages/api/oauth/google/start.ts`
- `apps/web/src/pages/api/oauth/google/callback.ts`
- `apps/web/src/lib/accounts/youtubeOauthService.ts`
- `packages/shared/src/services/youtubeAuth.ts`

**Notes:**
- GET `/api/oauth/google/start` - builds OAuth URL with workspace/user state
- GET `/api/oauth/google/callback` - exchanges code for tokens, fetches channel info, saves account
- Tokens stored in `connected_accounts` with `access_token_encrypted_ref`, `refresh_token_encrypted_ref`, `expires_at`
- Channel info stored as `external_id` (channel ID) and `display_name` (channel title)

### Token Refresh Logic

**Status:** DONE  
**Files:**
- `packages/shared/src/services/youtubeAuth.ts` (`getFreshYouTubeAccessToken()`)
- `apps/worker/src/jobs/refreshTikTokTokens.ts` (TikTok refresh exists, YouTube uses shared service)

**Notes:**
- `getFreshYouTubeAccessToken()` checks expiry (refreshes if expires within 5 minutes)
- Calls `refreshYouTubeAccessToken()` to get new token
- Updates `connected_accounts` with new token and expiry
- Used by `PUBLISH_YOUTUBE` pipeline

### PUBLISH_YOUTUBE Pipeline Using Fresh Tokens + Connected Accounts

**Status:** DONE  
**Files:**
- `apps/worker/src/pipelines/publish-youtube.ts`
- `apps/worker/src/services/youtube/client.ts`

**Notes:**
- Fetches connected account by ID
- Calls `getFreshYouTubeAccessToken()` to get/refresh token
- Uses `YouTubeClient` to upload short to YouTube
- Updates clip `status='published'`, `external_id` (video ID)
- Updates `variant_posts` if experiment context exists
- **Gap:** Only handles single account (first in `connectedAccountIds[]`); should loop for multi-account

---

## F) TikTok Integration (V1 Scope)

### Existing TikTok-Related Models, APIs, or Pipelines

**Status:** PARTIAL  
**Files:**
- `apps/web/src/app/api/auth/tiktok/connect/route.ts`
- `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts`
- `apps/web/pages/api/auth/tiktok_legacy/` (legacy routes)
- `apps/worker/src/jobs/refreshTikTokTokens.ts`
- `apps/worker/src/worker.ts` (PUBLISH_TIKTOK stub)

**Notes:**
- **OAuth:** ✅ Exists but incomplete
  - OAuth start/callback routes exist
  - Token exchange and storage implemented
  - Uses `sealedBoxEncryptRef()` for token encryption (implementation not visible in audit)
  - Stores tokens in `connected_accounts` table
- **Models:** ✅ Connected accounts table supports TikTok platform
- **Publishing:** ❌ NOT IMPLEMENTED
  - No `/api/publish/tiktok` endpoint
  - `PUBLISH_TIKTOK` pipeline is stub only (logs and returns success without doing work)
  - No TikTok API client implementation

### What's Missing to Reach V1 Spec

**Status:** MISSING  
**Files:**
- Need: `apps/web/src/pages/api/publish/tiktok.ts`
- Need: `apps/worker/src/pipelines/publish-tiktok.ts`
- Need: `apps/worker/src/services/tiktok/client.ts`

**Notes:**
- **Missing:** `/api/publish/tiktok` endpoint (mirror of YouTube publish API)
- **Missing:** `PUBLISH_TIKTOK` pipeline implementation
- **Missing:** TikTok API client for video upload
- **Missing:** Token refresh integration (refresh job exists but may need wiring)
- **Missing:** Multi-account support for TikTok publishing
- **Missing:** Integration with viral experiments (variant_posts creation/update)

---

## G) Security & Multi-Tenancy

### Auth Resolution Helper(s)

**Status:** DONE  
**Files:**
- `apps/web/src/lib/auth.ts` (`requireUser()`)
- `apps/web/src/lib/withAuthContext.ts`
- `packages/shared/src/auth/context.ts`

**Notes:**
- `requireUser()` extracts `x-debug-user` and `x-debug-workspace` headers
- `withAuthContext()` middleware for Next.js App Router routes
- Builds Supabase RLS client with user context
- Throws `HttpError(401)` if user missing

### Workspace Scoping in Queries

**Status:** DONE (mostly)  
**Files:**
- All API routes check workspace membership
- RLS policies in migrations enforce workspace isolation

**Notes:**
- Most queries include `workspace_id` filter
- RLS policies on tables enforce workspace membership via `workspace_members` join
- **Gap:** Some queries may rely on RLS only; explicit `workspace_id` filters are safer
- **Gap:** Worker uses service role (bypasses RLS); relies on explicit `workspace_id` in job payload

### Handling of Secrets/Keys

**Status:** PARTIAL  
**Files:**
- `packages/shared/src/env.ts` (centralized env vars)
- Token storage uses `*_encrypted_ref` fields

**Notes:**
- Environment variables centralized in `env.ts` with validation
- Tokens stored as `access_token_encrypted_ref` / `refresh_token_encrypted_ref`
- **Gap:** Encryption implementation (`sealedBoxEncryptRef`/`sealedBoxDecryptRef`) not visible in audit
- **Gap:** Need to verify encryption is actually implemented (not just placeholder)
- **Gap:** Need to verify encryption keys are stored securely (not in code)

### Basic Rate Limiting / Abuse Protection

**Status:** DONE  
**Files:**
- `apps/web/src/lib/rate-limit.ts`
- `packages/shared/src/billing/checkRateLimit.ts`

**Notes:**
- Rate limiting implemented on key endpoints (`/api/upload/init`, `/api/publish/youtube`, etc.)
- Uses token bucket or similar algorithm
- Returns 429 when rate limited
- Usage limits also serve as soft guard against abuse

---

## H) Observability & Operations

### Structured Logging (api + worker)

**Status:** DONE  
**Files:**
- `packages/shared/src/logging/logger.ts`
- `apps/web/src/lib/logger.ts`
- `apps/worker/src/services/logger.ts`

**Notes:**
- Centralized logger with structured JSON output
- Logs include: `service`, `workspaceId`, `userId`, `jobId` (worker), event names
- Key events logged: `upload_init_start/success`, `pipeline_completed/failed`, `publish_youtube_start/success`, etc.
- Logging redaction for sensitive data

### Error Handling Patterns (HttpError, Job Failures)

**Status:** DONE  
**Files:**
- `apps/web/src/lib/errors.ts` (`HttpError` class)
- `apps/web/src/lib/http.ts` (`handler`, `ok`, `err` helpers)
- `apps/worker/src/worker.ts` (job failure handling)

**Notes:**
- API: `HttpError` class with status, code, message
- API: Consistent JSON error responses via `err()` helper
- Worker: Jobs that throw are marked `status='failed'` with `last_error`
- Worker: Exponential backoff on retries
- Worker: Sentry integration for error tracking

### Health/Readiness Checks

**Status:** PARTIAL  
**Files:**
- `apps/web/src/pages/api/health.ts`
- `apps/web/src/app/api/health/audit/route.ts`

**Notes:**
- Basic health endpoint exists
- **Gap:** No readiness checks (DB connectivity, queue connectivity, storage connectivity)
- **Gap:** No `/api/readyz` endpoint as mentioned in spec
- **Gap:** Health endpoint may not check all dependencies

---

## Summary by Status

### DONE ✅
- Upload/init API (file + YouTube)
- All core pipelines (YOUTUBE_DOWNLOAD, TRANSCRIBE, HIGHLIGHT_DETECT, CLIP_RENDER, THUMBNAIL_GEN)
- Connected accounts models + APIs
- Publish config models + APIs
- Viral experiment tables + APIs
- Usage tracking and enforcement
- YouTube OAuth and publishing
- Auth resolution and workspace scoping
- Rate limiting
- Structured logging and error handling

### PARTIAL ⚠️
- End-to-end pipeline orchestration (missing auto-render trigger)
- Multi-account YouTube publishing (pipeline only handles single account)
- TikTok OAuth (exists but incomplete)
- Variant config application during publish (not yet using variant config)
- Secrets encryption (implementation not verified)
- Health/readiness checks (basic only)

### MISSING ❌
- TikTok publishing (`/api/publish/tiktok` + `PUBLISH_TIKTOK` pipeline)
- Automatic clip rendering after highlight detection
- Final project status transition to `clips_ready`
- Multi-account loop in `PUBLISH_YOUTUBE` pipeline
- TikTok API client implementation

---

## Critical Path to V1 Readiness

1. **TikTok Publishing** (highest priority for V1)
   - Implement `/api/publish/tiktok` endpoint
   - Implement `PUBLISH_TIKTOK` pipeline
   - Build TikTok API client
   - Integrate with viral experiments

2. **Pipeline Orchestration**
   - Auto-enqueue `CLIP_RENDER` jobs after `HIGHLIGHT_DETECT`
   - Set `project.status='clips_ready'` when all clips rendered

3. **Multi-Account Publishing**
   - Update `PUBLISH_YOUTUBE` to loop through all `connectedAccountIds`
   - Test end-to-end multi-account flow

4. **Verification**
   - Verify token encryption is actually implemented
   - Add readiness checks for DB/queue/storage
   - End-to-end test: upload → clips_ready → publish to multiple accounts

---

## Notes

- This audit is based on code inspection only; no runtime testing was performed
- Some implementation details (e.g., encryption functions) may exist but were not visible in the files audited
- RLS policies exist but were not exhaustively verified
- Test coverage was not audited (separate concern)

