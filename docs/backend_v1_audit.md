# Cliply Backend V1 Audit & Gap Map

## 1. High-Level Overview

### Monorepo Structure Summary

The Cliply backend is a **pnpm monorepo** with the following structure:

- **`apps/web`**: Next.js 14 application serving both web UI and API routes (via `pages/api/` and `app/api/`)
- **`apps/worker`**: Background job processor that polls Supabase for jobs and executes pipelines
- **`packages/shared`**: Shared TypeScript package containing billing logic, schemas, logging, constants, and types
- **`db/`**: SQL schema definitions and migrations
- **`test/`**: Test suites for API, worker, and web components
- **`supabase/`**: Supabase configuration and migrations

**No separate `apps/api`** - the web app handles all API routes via Next.js.

### App/Package Breakdown

#### `apps/web`
- **Purpose**: Next.js application providing both frontend pages and backend API routes
- **Key Features**:
  - API routes in `pages/api/` for upload, jobs, clips, projects, publishing, OAuth, billing
  - App router routes in `app/api/` for newer endpoints (TikTok OAuth, health checks)
  - Middleware for auth (`require-auth.ts`), rate limiting (`with-rate-limit.ts`), plan gating (`withPlanGate.ts`), idempotency
  - Supabase client integration for database access
  - Stripe integration for billing webhooks
  - Sentry integration for error tracking

#### `apps/worker`
- **Purpose**: Background job processor that polls Supabase `jobs` table and executes pipelines
- **Key Features**:
  - Polling-based job queue (no external queue system like BullMQ)
  - Job claiming via Supabase RPC (`worker_claim_next_job`)
  - Heartbeat mechanism to prevent stale jobs
  - Stale job reclamation on boot and periodic intervals
  - **Critical Issue**: Main `worker.ts` has stub handlers that just sleep; actual pipeline implementations exist in `pipelines/` but are not wired up
  - Pipeline modules exist for: transcribe, highlight-detect, clip-render, thumbnail, publish-youtube

#### `packages/shared`
- **Purpose**: Shared TypeScript code used by both web and worker
- **Key Modules**:
  - `billing/`: Plan matrix (`planMatrix.ts`), plan gating (`planGate.ts`), rate limiting (`checkRateLimit.ts`, `rateLimitConfig.ts`), Stripe mapping (`stripePlanMap.ts`)
  - `schemas/`: Zod schemas for job payloads (`jobs.ts`), upload flows (`upload.ts`)
  - `logging/`: Structured logger (`logger.ts`), audit logger (`auditLogger.ts`), redaction utilities (`redactSensitive.ts`)
  - `constants.ts`: Storage bucket names, MIME types, upload limits
  - `types/`: TypeScript types for auth, billing, Supabase database
  - `env.ts`: Environment variable validation

---

## 2. Pillar-by-Pillar Status

### 2.1 Auth, Users, Workspaces

#### What Exists (Now)

- **Database Schema** (`db/schema.sql`):
  - `organizations` table (id, name, owner_id)
  - `workspaces` table (id, name, owner_id, org_id) - supports multi-org structure
  - `org_workspaces` junction table for many-to-many org ↔ workspace relationships
  - `connected_accounts` table (id, user_id, workspace_id, provider, external_id) - stores OAuth connections

- **Auth Middleware** (`apps/web/src/middleware/require-auth.ts`):
  - Extracts user from request (Supabase JWT or debug headers)
  - Validates workspace header (`validateWorkspaceHeader.ts`)

- **Auth Context** (`packages/shared/auth/context.ts`):
  - `buildAuthContext()` function that extracts user, workspace, and plan from request
  - Plan name resolution from workspace metadata

- **OAuth Flows**:
  - TikTok OAuth implemented (`apps/web/src/app/api/auth/tiktok/connect/`)
  - Google OAuth stub exists (`apps/web/src/pages/api/oauth/google/start.ts`) but returns placeholder URL
  - OAuth tokens stored in `connected_accounts` with encryption references

#### What's Missing or Partial

- **User Management**:
  - No explicit `users` table in schema (relies on Supabase Auth)
  - No user profile management endpoints
  - No workspace membership/role management (only `owner_id` in workspaces table)
  - No multi-member workspace support beyond owner

- **Workspace Access Control**:
  - No RBAC (roles/permissions) system
  - No workspace member invitation/management APIs
  - Workspace access appears to be binary (owner vs. no access)

- **Multi-Account Per Workspace**:
  - `connected_accounts` table supports multiple accounts per workspace (via `workspace_id`)
  - However, no UI/API endpoints to manage multiple accounts
  - No concept of "default account" for publishing

#### Risk/Complexity Level

**Medium** - The foundation exists, but multi-member workspaces and proper RBAC are missing. This will be needed for agency mode.

#### Notes / Gotchas

- Workspace selection appears to be via header (`x-workspace-id`) rather than URL path or subdomain
- OAuth flows have test bypasses (`TEST_BYPASS_AUTH = true`) that need to be removed for production
- TikTok OAuth stores encrypted token references but encryption function `sealedBoxEncryptRef` is empty stub

---

### 2.2 Inputs & Uploads (File + YouTube)

#### What Exists (Now)

- **Upload Init Endpoint** (`apps/web/src/pages/api/upload/init.ts`):
  - Supports both `file` and `youtube` source types
  - File uploads: generates signed Supabase Storage URL, creates project record
  - YouTube uploads: creates project with `source_path` set to YouTube URL
  - Rate limiting via `checkRateLimit(userId, 'upload:init')`
  - Idempotency support

- **Upload Complete Endpoint** (`apps/web/src/pages/api/upload/complete.ts`):
  - Enqueues `TRANSCRIBE` job after file upload completes
  - Rate limiting enforced

- **Storage Buckets** (`packages/shared/src/constants.ts`):
  - `BUCKET_VIDEOS`: Original uploaded videos
  - `BUCKET_TRANSCRIPTS`: Transcript files (SRT and JSON)
  - `BUCKET_RENDERS`: Rendered clip videos
  - `BUCKET_THUMBS`: Thumbnail images

- **Storage Utilities** (`apps/web/src/lib/storage.ts`):
  - `getSignedUploadUrl()` for direct client uploads
  - Supabase Storage integration

- **Project Schema** (`db/schema.sql`):
  - `projects` table with `source_type` ('file' | 'youtube'), `source_path`, `status` ('queued' | 'processing' | 'ready' | 'error')

#### What's Missing or Partial

- **YouTube URL Processing**:
  - Project created with YouTube URL, but no worker job to download/process YouTube videos
  - No YouTube API integration to fetch video metadata or download video
  - No validation that YouTube URL is accessible/valid

- **Upload Validation**:
  - File size limits defined in constants (`MAX_UPLOAD_FILE_BYTES`, `MAX_UPLOAD_SIZE_BYTES`) but not enforced in upload init
  - No file type validation beyond MIME type mapping
  - No virus scanning or content validation

- **Upload Progress Tracking**:
  - No webhook or polling mechanism to track upload progress
  - Client must call `/upload/complete` after upload finishes (no automatic detection)

- **Error Handling**:
  - No cleanup of orphaned projects if upload fails
  - No retry mechanism for failed uploads

#### Risk/Complexity Level

**High** - YouTube URL support is incomplete. File uploads work but lack validation. This is a blocker for V1.

#### Notes / Gotchas

- YouTube projects are created but never processed (no job to download/transcribe YouTube videos)
- Upload flow assumes client-side upload to Supabase Storage (no server-side proxy)
- No deduplication of YouTube URLs (same URL can create multiple projects)

---

### 2.3 Pipelines (Transcribe, Highlight, Render, Thumbnail)

#### What Exists (Now)

- **Pipeline Implementations** (`apps/worker/src/pipelines/`):
  - **`transcribe.ts`**: Downloads video, calls transcriber service, uploads SRT/JSON transcripts, enqueues `HIGHLIGHT_DETECT` job
  - **`highlight-detect.ts`**: Reads transcript JSON, groups segments, scores candidates by keywords, creates `clips` records with `start_s`/`end_s`
  - **`clip-render.ts`**: Downloads source video, uses FFmpeg to extract clip segment, generates thumbnail, uploads to storage, updates clip status to 'ready'
  - **`thumbnail.ts`**: Generates thumbnail from rendered clip or source video at specified timestamp
  - **`publish-youtube.ts`**: Downloads rendered clip, calls YouTube API (currently stubbed with dryrun), updates clip status

- **Transcriber Service** (`apps/worker/src/services/transcriber/`):
  - Supports Deepgram and Whisper (via `getTranscriber()`)
  - Returns both SRT and JSON transcript formats

- **FFmpeg Service** (`apps/worker/src/services/ffmpeg/`):
  - `build-commands.ts`: Builds FFmpeg command-line args for clip extraction with subtitles
  - `run.ts`: Executes FFmpeg with logging

- **Job Queue System**:
  - Jobs stored in Supabase `jobs` table
  - Worker polls via `worker_claim_next_job` RPC
  - Job statuses: 'queued' | 'running' | 'succeeded' | 'failed'
  - Exponential backoff on failure (2^(attempts-1) * 10 seconds, max 1800s)
  - Heartbeat mechanism to detect stale jobs

- **Pipeline Chaining**:
  - `TRANSCRIBE` → `HIGHLIGHT_DETECT` (automatic)
  - `HIGHLIGHT_DETECT` creates clips in 'proposed' status
  - Clips must be manually approved before rendering (no auto-render)

#### What's Missing or Partial

- **Worker Integration**:
  - **CRITICAL**: `apps/worker/src/worker.ts` has stub handlers that just sleep (lines 113-147)
  - Actual pipeline implementations exist but are NOT wired into the worker
  - `apps/worker/src/jobs/run.ts` only has `TRANSCRIBE` handler wired (and it's a stub)
  - Worker will not execute any real pipeline work until this is fixed

- **YouTube Download Pipeline**:
  - No pipeline to download YouTube videos
  - Projects with `source_type='youtube'` will never be processed

- **Idempotency & Recovery**:
  - Pipelines check if outputs exist before processing (good)
  - But no mechanism to resume partial failures (e.g., if FFmpeg crashes mid-render)
  - No cleanup of temp files on failure

- **Pipeline Orchestration**:
  - No automatic clip rendering after approval
  - No automatic thumbnail generation (must be triggered separately)
  - No batch processing of multiple clips

- **Error Handling**:
  - Errors are logged and re-thrown, but no retry logic within pipelines
  - No dead-letter queue for permanently failed jobs
  - No alerting for repeated failures

#### Risk/Complexity Level

**CRITICAL / High** - The worker stub issue is a hard blocker. Even if fixed, YouTube processing is missing.

#### Notes / Gotchas

- Worker uses polling (1s default) rather than LISTEN/NOTIFY, which adds latency
- FFmpeg commands are built but not validated before execution
- Thumbnail generation has a bug: `ensureFileExists()` writes empty file if missing (line 176-182 in clip-render.ts)
- Pipeline types use `WorkerContext` interface but worker.ts doesn't provide it to handlers

---

### 2.4 Multi-Account & Publishing

#### What Exists (Now)

- **Connected Accounts Table** (`db/schema.sql`):
  - Stores OAuth connections per workspace
  - Fields: `user_id`, `workspace_id`, `provider`, `external_id`
  - Unique constraint on `(provider, external_id)`

- **TikTok OAuth** (`apps/web/src/app/api/auth/tiktok/connect/`):
  - Full OAuth flow implemented (PKCE)
  - Stores tokens in `connected_accounts` (encrypted references)
  - Token refresh job exists (`apps/worker/src/jobs/refreshTikTokTokens.ts`)

- **Google/YouTube OAuth**:
  - Stub endpoint exists (`apps/web/src/pages/api/oauth/google/start.ts`) but returns placeholder
  - No callback handler

- **Publish YouTube Endpoint** (`apps/web/src/pages/api/publish/youtube.ts`):
  - Accepts clipId, title, description, tags, visibility, scheduleAt, accountId
  - Enqueues `PUBLISH_YOUTUBE` job
  - Supports scheduling via `schedules` table
  - Idempotency support

- **Publish Pipeline** (`apps/worker/src/pipelines/publish-youtube.ts`):
  - Downloads rendered clip
  - Calls YouTube client (currently stubbed with `dryrun` token)
  - Updates clip `external_id` and `published_at`
  - Marks schedule as 'sent'

- **YouTube Client** (`apps/worker/src/services/youtube/client.ts`):
  - `YouTubeClient` class exists but `uploadShort()` returns fake `dryrun_${uuid}` video ID
  - No actual YouTube API integration

- **Schedules Table** (`db/schema.sql`):
  - Stores scheduled publishes (clip_id, run_at, status)
  - Cron job exists to scan schedules (`apps/web/src/pages/api/cron/scan-schedules.ts`)

#### What's Missing or Partial

- **Account Selection**:
  - `publish/youtube.ts` accepts `accountId` but doesn't validate it exists or belongs to workspace
  - No API to list connected accounts for a workspace
  - No default account selection logic

- **YouTube API Integration**:
  - YouTube client is completely stubbed
  - No OAuth token retrieval from `connected_accounts`
  - No actual video upload to YouTube
  - No error handling for YouTube API failures

- **Multi-Platform Publishing**:
  - Only YouTube schema exists (`PUBLISH_YOUTUBE` job kind)
  - TikTok publishing job kind exists (`PUBLISH_TIKTOK`) but no pipeline implementation
  - No abstraction for platform-agnostic publishing

- **Publishing Metadata**:
  - No storage of published video URLs or platform-specific IDs beyond `external_id`
  - No tracking of publish attempts vs. successes
  - No support for editing published videos (caption, thumbnail, etc.)

- **Rate Limiting for Publishing**:
  - No per-account rate limiting (could spam platforms)
  - No daily/hourly limits on publishes per workspace

#### Risk/Complexity Level

**High** - Publishing is completely non-functional (stubbed). Multi-account support exists in schema but not in APIs.

#### Notes / Gotchas

- `connected_accounts` table has `provider` field but schema doesn't define allowed values
- TikTok OAuth stores tokens but no pipeline uses them
- Schedule scanning cron job exists but may not be deployed/configured
- YouTube OAuth flow is incomplete (start endpoint is stub)

---

### 2.5 Viral Engine / Experiment System

#### What Exists (Now)

- **Nothing** - No tables, jobs, or code related to experiments, variants, or performance tracking.

#### What's Missing or Partial

- **Complete System Missing**:
  - No `experiments` table
  - No `variants` table
  - No `performance_snapshots` table
  - No job kind for performance polling (`PERFORMANCE_POLL` or similar)
  - No job kind for variant generation (`GENERATE_VARIANT` or similar)
  - No job kind for variant publishing (`PUBLISH_VARIANT` or similar)
  - No logic to compare performance against thresholds
  - No logic to generate new variants (caption, hashtags, thumbnail, sound variations)
  - No logic to delete/replace underperforming posts
  - No rate limiting for re-posting

#### Minimal V1 Design Proposal

**Database Schema Additions:**

```sql
-- Experiments group variants for a clip+account
CREATE TABLE experiments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  clip_id uuid NOT NULL REFERENCES clips(id),
  connected_account_id uuid NOT NULL REFERENCES connected_accounts(id),
  performance_target_views integer,
  performance_target_retention_pct numeric,
  time_window_hours integer DEFAULT 24,
  max_variants integer DEFAULT 5,
  status text CHECK (status IN ('active', 'paused', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

-- Variants are specific packaging of a clip for a platform
CREATE TABLE variants (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id),
  clip_id uuid NOT NULL REFERENCES clips(id),
  connected_account_id uuid NOT NULL REFERENCES connected_accounts(id),
  external_id text, -- Platform video ID
  caption text,
  hashtags text[],
  thumbnail_path text,
  sound_id text, -- Platform-specific sound ID
  published_at timestamptz,
  status text CHECK (status IN ('draft', 'published', 'deleted', 'failed')),
  created_at timestamptz DEFAULT now()
);

-- Performance snapshots track metrics at time windows
CREATE TABLE performance_snapshots (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES variants(id),
  views integer,
  likes integer,
  comments integer,
  shares integer,
  retention_pct numeric,
  snapshot_at timestamptz DEFAULT now(),
  window_hours integer -- Hours since publish
);
```

**Worker Jobs:**

1. **`EXPERIMENT_START`**: Creates experiment + first variant, publishes variant #1
2. **`PERFORMANCE_POLL`**: Fetches metrics from platform API, inserts snapshot, compares against thresholds
3. **`GENERATE_VARIANT`**: Creates new variant with different caption/hashtags/thumbnail (AI or template-based)
4. **`PUBLISH_VARIANT`**: Publishes variant, optionally deletes old one
5. **`EXPERIMENT_EVALUATE`**: Checks if experiment should continue or stop (success threshold met or variant budget exhausted)

**Integration Points:**

- Reuse existing `publish-youtube.ts` pipeline (extend to support variants)
- Reuse existing `connected_accounts` table for account selection
- Add rate limiting to prevent spam (max N variants per day per account)
- Add workspace-level limits (max active experiments per plan)

#### Risk/Complexity Level

**High** - This is a net-new feature with no existing foundation. Requires platform API integrations, AI/template system for variant generation, and complex state management.

#### Notes / Gotchas

- Platform APIs (YouTube, TikTok) have rate limits that must be respected
- Deleting/replacing posts may violate platform ToS - need legal review
- Variant generation requires either AI (costly) or template system (limited creativity)
- Performance metrics may not be available immediately (platforms have delays)

---

### 2.6 Dropshipping / Agency Mode

#### What Exists (Now)

- **Organizations Table** (`db/schema.sql`):
  - `organizations` table exists with `owner_id`
  - `org_workspaces` junction table allows multiple workspaces per org
  - Workspaces can belong to an org (`workspace.org_id`)

- **Plan Matrix** (`packages/shared/billing/planMatrix.ts`):
  - `premium` plan has `max_team_members: 15` (hints at agency use case)

#### What's Missing or Partial

- **Agency Management**:
  - No concept of "agency" vs. "client" workspaces
  - No manager/client role distinction
  - No APIs to create/manage client workspaces from agency account
  - No billing aggregation (agency pays for all client workspaces)
  - No white-labeling or branding customization

- **Multi-Workspace Management**:
  - No API to list all workspaces in an org
  - No cross-workspace analytics or reporting
  - No workspace templates or cloning

- **Client Onboarding**:
  - No automated workspace creation for clients
  - No invitation system for clients to join their workspace

#### Risk/Complexity Level

**Medium** - The database foundation exists (orgs, org_workspaces), but all application logic is missing.

#### Notes / Gotchas

- `organizations` table exists but is never used in code
- No migration path for existing workspaces to join an org
- Agency mode would require significant UI/UX work beyond backend

---

### 2.7 Plans, Limits, Billing & Rate Limiting

#### What Exists (Now)

- **Plan Matrix** (`packages/shared/billing/planMatrix.ts`):
  - Three plans: `basic`, `pro`, `premium`
  - Limits defined: `uploads_per_day`, `clips_per_project`, `max_team_members`, `storage_gb`, `concurrent_jobs`
  - Feature flags: `schedule`, `ai_titles`, `ai_captions`, `watermark_free_exports`

- **Plan Gating** (`packages/shared/billing/planGate.ts`):
  - `checkPlanAccess()` checks if plan supports a feature
  - `enforcePlanAccess()` throws billing error if not available
  - `withPlanGate()` middleware wraps API handlers

- **Rate Limiting**:
  - **User-level** (`apps/web/src/lib/rate-limit.ts`): Token bucket per user+route (60 tokens, 60/min refill)
  - **Workspace-level** (`packages/shared/billing/checkRateLimit.ts`): Calls Supabase RPC `fn_consume_token` (implementation not visible)
  - **Rate limit table** (`db/schema.sql`): `rate_limits` table with `user_id`, `route`, `tokens`, `capacity`, `refill_per_min`
  - **Rate limit config** (`packages/shared/billing/rateLimitConfig.ts`): Defines rate limits per feature

- **Stripe Integration**:
  - Stripe webhook handler exists (`apps/web/src/pages/api/webhooks/stripe.ts`)
  - `stripePlanMap.ts` maps Stripe product/price IDs to plan names
  - Checkout endpoint exists (`apps/web/src/pages/api/billing/checkout.ts`)

- **Subscription Sync**:
  - Worker job exists (`apps/worker/src/jobs/syncSubscriptions.ts`) to sync Stripe subscriptions
  - Worker job exists (`apps/worker/src/jobs/initRateLimits.ts`) to initialize rate limits for workspaces

#### What's Missing or Partial

- **Usage Tracking**:
  - Plan matrix defines limits but **no code tracks actual usage**
  - No counters for `uploads_per_day`, `clips_per_project`, `storage_gb`
  - No enforcement of numeric limits (only boolean feature flags are checked)
  - No monthly reset mechanism for daily limits

- **Plan Enforcement**:
  - `checkPlanAccess()` returns `{ active: true }` for numeric limits without checking usage
  - No database tables to track usage (e.g., `usage_counters`, `daily_usage`)
  - Upload endpoints don't check `uploads_per_day` limit
  - Clip creation doesn't check `clips_per_project` limit

- **Storage Quotas**:
  - No tracking of storage used per workspace
  - No cleanup of old projects/clips when storage limit exceeded
  - No enforcement of `storage_gb` limit

- **Concurrent Jobs Limit**:
  - No enforcement of `concurrent_jobs` limit
  - Worker doesn't check how many jobs are running for a workspace before claiming new ones

- **Stripe Integration**:
  - Webhook handler exists but implementation not visible (may be incomplete)
  - No customer portal integration
  - No plan upgrade/downgrade flow
  - No prorating or refund logic

- **Billing Context**:
  - `buildAuthContext()` extracts plan from workspace, but no validation that plan is active/paid
  - No grace period for expired subscriptions
  - No free trial logic

#### Risk/Complexity Level

**High** - Plan definitions exist but enforcement is missing. This is a critical gap for preventing abuse and ensuring revenue.

#### Notes / Gotchas

- Rate limiting exists at two levels (user and workspace) which may cause confusion
- `fn_consume_token` RPC is referenced but not in visible schema (may be in Supabase functions)
- Plan gating middleware exists but is not used on all endpoints (e.g., upload endpoints only check rate limits, not plan limits)
- No audit trail for plan changes or usage spikes

---

### 2.8 Observability & Admin Tooling

#### What Exists (Now)

- **Structured Logging** (`packages/shared/logging/logger.ts`):
  - JSON-formatted logs with fields: `ts`, `service`, `event`, `workspaceId`, `jobId`, `message`, `error`, `meta`
  - Log levels: `info`, `warn`, `error`
  - Sampling support via `LOG_SAMPLE_RATE` env var
  - Automatic redaction of secrets (keys matching `/key|token|secret|password|authorization|bearer/i`)

- **Audit Logging** (`packages/shared/logging/auditLogger.ts`):
  - `auditLogger` function for audit events
  - Stores to `events_audit` table (referenced in code but not in visible schema)

- **Sentry Integration**:
  - Sentry initialized in worker (`apps/worker/src/worker.ts`)
  - Sentry configs in web app (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`)
  - Error capture in pipelines via `ctx.sentry.captureException()`

- **Job Status Tracking**:
  - Jobs table has `status`, `error` (JSONB), `attempts`, `last_heartbeat`
  - Job events table exists (`job_events` in migration) for event tracking

- **Health Endpoints**:
  - `/api/health` endpoint exists
  - `/api/health/audit` endpoint exists

- **Job APIs**:
  - `/api/jobs/[id]` - Get job by ID
  - `/api/jobs/search` - Search jobs
  - `/api/jobs/enqueue` - Enqueue new job

#### What's Missing or Partial

- **Admin APIs**:
  - No admin-only endpoints to retry failed jobs
  - No admin endpoint to cancel stuck jobs
  - No admin endpoint to unlock jobs (if worker crashes)
  - No admin endpoint to view all jobs for a workspace (only search exists)

- **Debugging Tools**:
  - No job replay mechanism
  - No way to inspect job payloads/history without direct DB access
  - No way to see which worker is processing which job (only `worker_id` in jobs table)

- **Metrics & Monitoring**:
  - No metrics export (Prometheus, StatsD, etc.)
  - No dashboards for job success rates, pipeline durations, error rates
  - No alerting for repeated failures or queue depth

- **Log Aggregation**:
  - Logs go to stdout/stderr (assumes external aggregation like CloudWatch, Datadog)
  - No structured log querying within the app
  - No log retention policy

- **Performance Tracking**:
  - No tracking of pipeline durations in database
  - No tracking of storage/API costs per workspace
  - No tracking of platform API rate limit usage

#### Risk/Complexity Level

**Medium** - Basic logging exists, but admin tooling is minimal. Debugging production issues will be difficult.

#### Notes / Gotchas

- Log sampling may hide important events if `LOG_SAMPLE_RATE < 1`
- Redaction may be too aggressive (could hide non-secret data)
- No correlation IDs to trace requests across services
- Job events table exists but pipelines don't emit events to it

---

## 3. Recommended Roadmap to V1

### Phase 0 – Hard Blockers to Selling to First Users

**Priority: CRITICAL - Must fix before any user can use the system**

1. **Wire Up Worker Pipelines** (Pillar: Pipelines)
   - **Description**: Replace stub handlers in `apps/worker/src/worker.ts` with actual pipeline calls
   - **Files**: `apps/worker/src/worker.ts`, `apps/worker/src/pipelines/*.ts`
   - **Complexity**: S
   - **Dependencies**: None
   - **Notes**: Import pipeline `run()` functions and call with proper `WorkerContext`. This is the #1 blocker.

2. **Implement YouTube Video Download** (Pillar: Inputs & Uploads)
   - **Description**: Create pipeline to download YouTube videos and store in `BUCKET_VIDEOS`
   - **Files**: New `apps/worker/src/pipelines/youtube-download.ts`, `apps/worker/src/services/youtube/download.ts`
   - **Complexity**: M
   - **Dependencies**: YouTube API key, `yt-dlp` or similar library
   - **Notes**: Must handle long videos, rate limits, and copyright issues.

3. **Implement Real YouTube Publishing** (Pillar: Multi-Account & Publishing)
   - **Description**: Replace stubbed `YouTubeClient.uploadShort()` with real YouTube Data API v3 integration
   - **Files**: `apps/worker/src/services/youtube/client.ts`, `apps/worker/src/pipelines/publish-youtube.ts`
   - **Complexity**: M
   - **Dependencies**: YouTube OAuth flow completion, YouTube Data API v3
   - **Notes**: Must handle OAuth token refresh, video upload resumable uploads, and API errors.

4. **Complete YouTube OAuth Flow** (Pillar: Multi-Account & Publishing)
   - **Description**: Implement Google OAuth callback and token storage
   - **Files**: `apps/web/src/pages/api/oauth/google/callback.ts`, update `start.ts`
   - **Complexity**: S
   - **Dependencies**: Google OAuth credentials
   - **Notes**: Similar to TikTok OAuth but for Google/YouTube.

5. **Enforce Usage Limits** (Pillar: Plans, Limits, Billing)
   - **Description**: Track and enforce `uploads_per_day`, `clips_per_project`, `storage_gb` limits
   - **Files**: New `packages/shared/billing/usageTracker.ts`, update upload/clip creation endpoints
   - **Complexity**: M
   - **Dependencies**: Usage counters table, plan context
   - **Notes**: Must add database tables for daily/monthly counters and reset logic.

6. **Fix Thumbnail Generation Bug** (Pillar: Pipelines)
   - **Description**: Remove `ensureFileExists()` that writes empty files in `clip-render.ts`
   - **Files**: `apps/worker/src/pipelines/clip-render.ts` (line 176-182)
   - **Complexity**: S
   - **Dependencies**: None

---

### Phase 1 – Minimum Viable Viral System

**Priority: HIGH - Core differentiator feature**

7. **Create Experiment/Variant Database Schema** (Pillar: Viral Engine)
   - **Description**: Add `experiments`, `variants`, `performance_snapshots` tables
   - **Files**: New migration in `supabase/migrations/`
   - **Complexity**: S
   - **Dependencies**: None

8. **Implement Performance Polling Pipeline** (Pillar: Viral Engine)
   - **Description**: Job that fetches metrics from YouTube API and stores in `performance_snapshots`
   - **Files**: New `apps/worker/src/pipelines/performance-poll.ts`
   - **Complexity**: M
   - **Dependencies**: YouTube Analytics API access, experiment schema

9. **Implement Experiment Evaluation Logic** (Pillar: Viral Engine)
   - **Description**: Compare performance snapshots against thresholds, decide if variant should be generated
   - **Files**: New `apps/worker/src/pipelines/experiment-evaluate.ts`
   - **Complexity**: M
   - **Dependencies**: Performance polling, experiment schema

10. **Implement Basic Variant Generation** (Pillar: Viral Engine)
    - **Description**: Create new variant with different caption/hashtags (template-based initially, not AI)
    - **Files**: New `apps/worker/src/pipelines/generate-variant.ts`
    - **Complexity**: M
    - **Dependencies**: Experiment schema, variant templates

11. **Implement Variant Publishing** (Pillar: Viral Engine)
    - **Description**: Publish variant, optionally delete old post
    - **Files**: Extend `publish-youtube.ts` or create `publish-variant.ts`
    - **Complexity**: S
    - **Dependencies**: Variant generation, publishing pipeline

12. **Add Experiment Rate Limiting** (Pillar: Viral Engine, Plans)
    - **Description**: Enforce max variants per day per account, max experiments per workspace
    - **Files**: Update rate limit config, add checks in experiment creation
    - **Complexity**: S
    - **Dependencies**: Usage tracking system

---

### Phase 1.5 – Multi-Account + Improved Publishing

**Priority: MEDIUM - Needed for production readiness**

13. **List Connected Accounts API** (Pillar: Multi-Account)
    - **Description**: Endpoint to list all connected accounts for a workspace
    - **Files**: New `apps/web/src/pages/api/accounts/index.ts`
    - **Complexity**: S
    - **Dependencies**: None

14. **Account Selection in Publishing** (Pillar: Multi-Account)
    - **Description**: Validate `accountId` in publish endpoint, support default account
    - **Files**: Update `apps/web/src/pages/api/publish/youtube.ts`
    - **Complexity**: S
    - **Dependencies**: Connected accounts API

15. **TikTok Publishing Pipeline** (Pillar: Multi-Account)
    - **Description**: Implement `PUBLISH_TIKTOK` pipeline (currently only job kind exists)
    - **Files**: New `apps/worker/src/pipelines/publish-tiktok.ts`, TikTok API client
    - **Complexity**: M
    - **Dependencies**: TikTok OAuth tokens, TikTok Upload API

16. **Publishing Error Handling** (Pillar: Multi-Account)
    - **Description**: Handle platform API errors, token refresh, retry logic
    - **Files**: Update publishing pipelines, add error recovery
    - **Complexity**: M
    - **Dependencies**: OAuth token refresh jobs

17. **Storage Quota Tracking** (Pillar: Plans, Limits)
    - **Description**: Calculate storage used per workspace, enforce `storage_gb` limit
    - **Files**: New `packages/shared/billing/storageTracker.ts`, update upload endpoints
    - **Complexity**: M
    - **Dependencies**: Storage bucket listing, usage tracking

---

### Phase 2 – Advanced Viral Tuning + Agency Features

**Priority: LOW - Nice to have for V1, can defer**

18. **AI-Powered Variant Generation** (Pillar: Viral Engine)
    - **Description**: Use AI to generate creative captions, hashtags, thumbnails
    - **Files**: New `apps/worker/src/services/ai/variant-generator.ts`
    - **Complexity**: XL
    - **Dependencies**: AI API (OpenAI, Anthropic), variant generation pipeline
    - **Notes**: Expensive, requires prompt engineering and testing.

19. **Multi-Workspace Management APIs** (Pillar: Agency Mode)
    - **Description**: APIs to list workspaces in org, create client workspaces
    - **Files**: New `apps/web/src/pages/api/orgs/*.ts`
    - **Complexity**: M
    - **Dependencies**: Organization schema (exists but unused)

20. **Workspace Member Management** (Pillar: Auth, Agency Mode)
    - **Description**: Add workspace members table, invitation system, role-based access
    - **Files**: New migration, new `apps/web/src/pages/api/workspaces/[id]/members/*.ts`
    - **Complexity**: L
    - **Dependencies**: RBAC design, invitation email system

21. **Admin Job Management APIs** (Pillar: Observability)
    - **Description**: Retry, cancel, unlock jobs; view job history
    - **Files**: New `apps/web/src/pages/api/admin/jobs/*.ts`
    - **Complexity**: M
    - **Dependencies**: Admin auth middleware

22. **Metrics Export** (Pillar: Observability)
    - **Description**: Export job metrics, pipeline durations to Prometheus/StatsD
    - **Files**: New `packages/shared/metrics/`, update pipelines
    - **Complexity**: M
    - **Dependencies**: Metrics aggregation service

---

## Summary

**Current State**: The codebase has a solid foundation with database schema, job queue, pipelines, and billing structure. However, **critical gaps** prevent it from being production-ready:

1. **Worker is non-functional** - Stub handlers prevent any pipeline execution
2. **YouTube support is incomplete** - No download or publishing
3. **Usage limits are not enforced** - Plans defined but not checked
4. **Viral engine is completely missing** - No experiments, variants, or performance tracking

**Estimated Effort to V1**:
- **Phase 0**: 2-3 weeks (critical blockers)
- **Phase 1**: 3-4 weeks (viral engine MVP)
- **Phase 1.5**: 2-3 weeks (multi-account polish)
- **Total**: ~8-10 weeks for production-ready V1

**Biggest Risks**:
1. Worker stub issue could cause complete system failure
2. YouTube API integration complexity (OAuth, rate limits, uploads)
3. Viral engine requires new platform API integrations (Analytics)
4. Usage tracking requires careful design to avoid performance issues

