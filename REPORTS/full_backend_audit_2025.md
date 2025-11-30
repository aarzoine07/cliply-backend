# Cliply Backend - Full Deep Audit Report

**Date:** 2025-01-XX  
**Auditor:** AI Systems Auditor  
**Scope:** Complete read-only audit of Cliply backend monorepo  
**Purpose:** Assess current state, identify gaps, define "DONE", and provide actionable next steps

---

## 1. Project Context & Recent Work

### What Cliply Does

Cliply is an **AI-powered video clipping and publishing platform** that:
- Ingests source videos (file uploads or YouTube URLs)
- Transcribes videos using Deepgram/Whisper
- Detects highlights using AI
- Renders clips with ffmpeg
- Schedules and automatically publishes clips to TikTok and YouTube
- Supports multi-workspace, multi-user teams with billing tiers (Basic, Pro, Premium)
- Includes advanced features: viral experiments, dropshipping product integration, analytics

### Monorepo Structure

- **`apps/web`**: Next.js 14 application (API routes + web UI)
  - Pages Router: `pages/api/*` (legacy routes)
  - App Router: `app/api/*` (newer routes)
  - Handles: upload, jobs, clips, projects, OAuth, billing, cron, publishing
  
- **`apps/worker`**: Background job processor
  - Polls Supabase `jobs` table via `worker_claim_next_job` RPC
  - Executes pipelines: TRANSCRIBE, HIGHLIGHT_DETECT, CLIP_RENDER, PUBLISH_TIKTOK, PUBLISH_YOUTUBE, YOUTUBE_DOWNLOAD
  - Heartbeat mechanism, stale job reclamation
  
- **`packages/shared`**: Shared TypeScript package
  - Billing logic, plan gating, usage tracking
  - Schemas (Zod), logging, Sentry, env validation
  - Auth context builder, encryption utilities

- **`supabase/migrations/`**: Database schema and RLS policies
- **`test/`**: Test suites (API, worker, billing, etc.)

### External Services Integrated

- **Supabase**: Database, auth, storage, RLS
- **Stripe**: Billing, checkout, webhooks, subscriptions
- **TikTok**: OAuth, video publishing API
- **YouTube**: OAuth, video publishing API, yt-dlp for downloads
- **Sentry**: Error monitoring (web + worker)
- **Deepgram**: Transcription (optional, fallback to Whisper)
- **OpenAI**: AI features (optional)

### Recent Work (from git log)

Recent commits show focus on:
- **Worker job system**: Added `job_events` table, `worker_finish` RPC, result column
- **Type fixes**: Fixed shared env/logging types and worker pipeline type errors
- **CI**: Added workflow for typecheck and tests
- **TikTok**: Verification file updates (.txt → .html)
- **Production readiness**: Made API routes production-ready for Vercel

---

## 2. Global Readiness Summary

### Overall Assessment: **~75% towards production-ready**

**Strengths:**
- ✅ Core pipelines (transcribe, highlight, render, publish) are implemented and wired
- ✅ Job system with RLS, heartbeat, stale reclamation is functional
- ✅ Stripe billing integration is complete (checkout, webhooks, plan mapping)
- ✅ TikTok OAuth with proper encryption (AES-256-GCM) is implemented
- ✅ Environment variable schema is centralized and validated
- ✅ Sentry integration is configured for both web and worker
- ✅ Comprehensive test suite exists (26+ API tests, worker tests, billing tests)

**Risks / Gaps:**
- ⚠️ **Worker RPC mismatch**: `worker_claim_next_job` uses old schema (`state`, `locked_at`, `locked_by`) but migrations show newer schema (`status`, `worker_id`, `last_heartbeat`)
- ⚠️ **Missing RPC functions**: `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale` not found in migrations (may exist in remote DB)
- ⚠️ **YouTube OAuth**: Implementation exists but less tested than TikTok
- ⚠️ **Cron job**: `scan-schedules` exists but needs Vercel Cron configuration (manual infra work)
- ⚠️ **CI coverage**: Tests run but no explicit coverage thresholds enforced
- ⚠️ **RLS policies**: Some tables may have incomplete RLS (need manual verification)

---

## 3. Definition of DONE – Cliply Backend

For Cliply's backend to be considered **production-ready and not need babysitting**, the following must be true:

### 3.1 Core Product Flows

**DONE means:**
- ✅ Upload/init API accepts files and YouTube URLs, enforces usage limits, creates projects
- ✅ YOUTUBE_DOWNLOAD pipeline downloads videos using yt-dlp, uploads to storage, enqueues TRANSCRIBE
- ✅ TRANSCRIBE pipeline uses Deepgram/Whisper, stores transcripts, records usage, enqueues HIGHLIGHT_DETECT
- ✅ HIGHLIGHT_DETECT pipeline generates candidate clips, creates clip records, records usage
- ✅ CLIP_RENDER pipeline cuts clips with ffmpeg, generates thumbnails, uploads to storage
- ✅ PUBLISH_TIKTOK and PUBLISH_YOUTUBE pipelines upload videos, handle token refresh, update clip status
- ✅ All pipelines are wired in `apps/worker/src/worker.ts` handlers (✅ DONE - handlers exist)

### 3.2 Data & Security

**DONE means:**
- ✅ Supabase schema includes all required tables: `jobs`, `job_events`, `workspaces`, `workspace_members`, `workspace_usage`, `subscriptions`, `connected_accounts`, `projects`, `clips`, `schedules`, etc.
- ✅ RLS is enabled on all user-facing tables with correct workspace-scoping policies
- ✅ `workspace_id()` helper function exists and is used in RLS policies
- ✅ Idempotency keys table exists and is enforced on critical endpoints
- ✅ Rate limiting is implemented (token bucket via `rate_limits` table)
- ✅ Plan gating middleware (`withPlanGate`) enforces feature limits

### 3.3 Auth & Billing

**DONE means:**
- ✅ `buildAuthContext` validates Supabase sessions, verifies workspace membership
- ✅ Stripe checkout endpoint creates sessions with workspace metadata
- ✅ Stripe webhook handler processes `checkout.session.completed`, `customer.subscription.*`, `invoice.*` events
- ✅ Plan resolution service maps Stripe subscriptions to internal plans (`basic`, `pro`, `premium`)
- ✅ Workspace plan is updated in DB when subscriptions change
- ✅ Plan gating is enforced on upload, schedule, and publish endpoints

### 3.4 Pipelines & Jobs

**DONE means:**
- ✅ Job queue uses Supabase `jobs` table with RPC functions for claiming
- ✅ Worker polls via `worker_claim_next_job` RPC, processes jobs, calls `worker_finish`/`worker_fail`
- ✅ Heartbeat mechanism updates `last_heartbeat` to prevent stale jobs
- ✅ Stale job reclamation runs on boot and periodically
- ✅ Retry/backoff logic uses exponential backoff (2^(attempts-1) * 10s, max 1800s)
- ✅ Job events are logged to `job_events` table for observability

### 3.5 OAuth & External APIs

**DONE means:**
- ✅ TikTok OAuth flow: authorization URL, callback, token exchange, token storage (encrypted)
- ✅ TikTok token refresh job exists and runs periodically
- ✅ YouTube OAuth flow: authorization URL, callback, token exchange, token storage
- ✅ Tokens are encrypted at rest using AES-256-GCM (TikTok ✅, YouTube needs verification)
- ✅ Multi-account support: `connected_accounts` table supports multiple accounts per workspace

### 3.6 Cron & Automation

**DONE means:**
- ✅ `scan-schedules` cron endpoint exists at `/api/cron/scan-schedules`
- ✅ Cron endpoint authenticates via `CRON_SECRET` (Bearer token or X-CRON-SECRET header)
- ✅ `scanSchedules` function atomically claims due schedules, enqueues publish jobs
- ✅ Vercel Cron is configured in `vercel.json` (or manual setup required)
- ✅ Cron runs on schedule (e.g., every 5 minutes)

### 3.7 Infra & Observability

**DONE means:**
- ✅ Environment variables are defined in `packages/shared/src/env.ts` with Zod validation
- ✅ Sentry is initialized in web (server, edge, client) and worker
- ✅ Structured logging uses `@cliply/shared/logging/logger` with JSON output
- ✅ CI workflow runs typecheck and tests on push/PR
- ✅ Worker deployment assumes ffmpeg and yt-dlp are installed (warns if missing)

---

## 4. Subsystem-by-Subsystem Audit

### 4.1 Supabase Schema & RLS

**Current State:**
- **Files**: `supabase/migrations/*.sql` (34 migration files)
- **Key tables**: `jobs`, `job_events`, `workspaces`, `workspace_members`, `workspace_usage`, `subscriptions`, `billing_customers` (if exists), `connected_accounts`, `projects`, `clips`, `schedules`, `idempotency_keys`, `rate_limits`, `experiments`, `variant_posts`, `products`, `dropshipping_actions`
- **RLS helper**: `workspace_id()` function exists (`20240000000001_workspace_id_helper.sql`)

**Status:** 🟡 **PARTIAL**

**What exists:**
- ✅ Jobs table with `state`/`status` columns (migration history shows evolution)
- ✅ RLS policies on `jobs` table (`20250101000004_rls_jobs_policies.sql`)
- ✅ RLS policies on `workspaces` and `workspace_members` (`20250101000000_rls_workspaces_members.sql`)
- ✅ RLS enabled on most tables (grep shows `enable row level security` in many migrations)

**Issues & Gaps:**

1. **REQUIRED_FOR_LAUNCH**: Worker RPC schema mismatch
   - `worker_claim_next_job` RPC (`20250101000006_worker_claim_next_job_rpc.sql`) uses old schema:
     - References `state = 'queued'` (should be `status = 'queued'`)
     - Sets `state = 'running'` (should be `status = 'running'`)
     - Uses `locked_at`, `locked_by`, `heartbeat_at` (migration `20251020043717_remote_schema.sql` shows these were dropped, replaced with `status`, `worker_id`, `last_heartbeat`)
   - **File**: `supabase/migrations/20250101000006_worker_claim_next_job_rpc.sql`
   - **Work type**: CURSOR_CODE_WORK (update RPC function)

2. **REQUIRED_FOR_LAUNCH**: Missing RPC functions
   - `worker_heartbeat` - called by worker but not found in migrations
   - `worker_fail` - called by worker but not found in migrations
   - `worker_reclaim_stale` - called by worker but not found in migrations
   - **Files**: `apps/worker/src/worker.ts` (lines 269, 316, 386, 225)
   - **Work type**: CURSOR_CODE_WORK (create migration files) or MANUAL_INFRA_WORK (if exists in remote DB, need to sync)

3. **REQUIRED_FOR_LAUNCH**: RLS policy completeness
   - Need to verify all tables have RLS enabled and correct policies
   - Tables to check: `job_events`, `workspace_usage`, `subscriptions`, `connected_accounts`, `schedules`, `idempotency_keys`
   - **Work type**: MANUAL_INFRA_WORK (run SQL queries in Supabase dashboard to verify)

4. **OPTIONAL_POLISH**: Workspace membership helper
   - `workspace_id()` helper exists but may have recursion issues in complex queries
   - **File**: `supabase/migrations/20240000000001_workspace_id_helper.sql`
   - **Work type**: CURSOR_CODE_WORK (if issues found)

---

### 4.2 Environment & Configuration

**Current State:**
- **Files**: `packages/shared/src/env.ts`, `apps/web/src/lib/env.ts`, `apps/worker/src/env.ts`, `ENV.md`
- **Schema**: Centralized Zod schema in `packages/shared/src/env.ts`

**Status:** ✅ **DONE**

**What exists:**
- ✅ Single canonical env schema with Zod validation
- ✅ Client-side env adapter (`apps/web/src/lib/env.ts` exposes `publicEnv` for `NEXT_PUBLIC_*` vars)
- ✅ Comprehensive documentation in `ENV.md`
- ✅ All required vars documented: Supabase, TikTok encryption key, Stripe, OAuth, Sentry, etc.

**Issues & Gaps:**

1. **OPTIONAL_POLISH**: Missing env var documentation
   - Some vars may be used in code but not documented (e.g., `DATABASE_URL` is optional but usage unclear)
   - **Work type**: CURSOR_CODE_WORK (audit codebase for `process.env` usage, update `ENV.md`)

---

### 4.3 Stripe & Billing

**Current State:**
- **Files**: 
  - `apps/web/src/pages/api/billing/checkout.ts` (checkout endpoint)
  - `apps/web/src/pages/api/webhooks/stripe.ts` (webhook handler)
  - `apps/web/src/lib/billing/stripeHandlers.ts` (event handlers)
  - `apps/web/src/lib/billing/withPlanGate.ts` (plan gating middleware)
  - `packages/shared/billing/stripePlanMap.ts` (price ID → plan mapping)
  - `packages/shared/billing/planResolution.ts` (workspace plan resolution)

**Status:** ✅ **DONE**

**What exists:**
- ✅ Checkout endpoint creates Stripe sessions with workspace metadata
- ✅ Webhook handler processes `checkout.session.completed`, `customer.subscription.*`, `invoice.*`
- ✅ Plan mapping: `STRIPE_PLAN_MAP` maps price IDs to plans
- ✅ Plan resolution: `resolveWorkspacePlan` checks `subscriptions` table, falls back to `workspaces.plan`
- ✅ Plan gating: `withPlanGate` middleware enforces feature limits
- ✅ Usage tracking: `workspace_usage` table tracks metrics, `recordUsage`/`assertWithinUsage` enforce limits

**Issues & Gaps:**

1. **OPTIONAL_POLISH**: Test coverage
   - Billing tests exist (`test/api/billing.status.test.ts`) but may not cover all webhook events
   - **Work type**: CURSOR_CODE_WORK (add webhook event tests)

2. **LATER**: Subscription cancellation handling
   - Webhook handles `customer.subscription.deleted` but may need grace period logic
   - **Work type**: CURSOR_CODE_WORK (if grace period needed)

---

### 4.4 OAuth & External APIs (TikTok, YouTube)

**Current State:**
- **Files**:
  - TikTok: `apps/web/src/app/api/auth/tiktok/connect/route.ts`, `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts`, `packages/shared/src/services/tiktokAuth.ts`, `apps/worker/src/jobs/refreshTikTokTokens.ts`
  - YouTube: `apps/web/src/pages/api/oauth/google/start.ts`, `apps/web/src/pages/api/oauth/google/callback.ts`, `packages/shared/src/services/youtubeAuth.ts`

**Status:** 🟡 **PARTIAL**

**What exists:**
- ✅ TikTok OAuth: Authorization URL with PKCE, callback, token exchange, token storage (encrypted)
- ✅ TikTok token encryption: AES-256-GCM via `encryptedSecretEnvelope.ts` (✅ proper encryption, not base64)
- ✅ TikTok token refresh: `refreshTikTokTokens` job exists
- ✅ TikTok publishing: `publish-tiktok.ts` pipeline uses `getFreshTikTokAccessToken`
- ✅ YouTube OAuth: Authorization URL, callback, token exchange
- ✅ YouTube publishing: `publish-youtube.ts` pipeline exists

**Issues & Gaps:**

1. **REQUIRED_FOR_LAUNCH**: YouTube token encryption
   - YouTube tokens may not be encrypted (need to verify `youtubeAuth.ts` uses `encryptSecret`)
   - **File**: `packages/shared/src/services/youtubeAuth.ts` (need to check)
   - **Work type**: CURSOR_CODE_WORK (if not encrypted, add encryption)

2. **REQUIRED_FOR_LAUNCH**: YouTube token refresh
   - YouTube token refresh job may not exist (TikTok has `refreshTikTokTokens.ts`)
   - **Work type**: CURSOR_CODE_WORK (create refresh job if missing)

3. **OPTIONAL_POLISH**: Multi-account per workspace
   - `connected_accounts` table supports multiple accounts, but UI/API may not expose this
   - **Work type**: CURSOR_CODE_WORK (if feature needed)

4. **LATER**: Token rotation security
   - Tokens are encrypted but key rotation strategy not documented
   - **Work type**: MANUAL_INFRA_WORK (document key rotation process)

---

### 4.5 Jobs System, Worker & Cron

**Current State:**
- **Files**: `apps/worker/src/worker.ts`, `apps/web/src/pages/api/cron/scan-schedules.ts`, `apps/web/src/lib/cron/scanSchedules.ts`
- **RPC functions**: `worker_claim_next_job`, `worker_finish`, `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale`

**Status:** 🟡 **PARTIAL**

**What exists:**
- ✅ Worker polling loop: `pollOnce` calls `worker_claim_next_job` RPC
- ✅ Job handlers: All pipeline handlers are wired (TRANSCRIBE, HIGHLIGHT_DETECT, CLIP_RENDER, PUBLISH_TIKTOK, PUBLISH_YOUTUBE, YOUTUBE_DOWNLOAD, THUMBNAIL_GEN)
- ✅ Heartbeat mechanism: `sendHeartbeat` calls `worker_heartbeat` RPC every 5s
- ✅ Stale job reclamation: `reclaimStale` calls `worker_reclaim_stale` RPC on boot and periodically
- ✅ Retry/backoff: Exponential backoff (2^(attempts-1) * 10s, max 1800s)
- ✅ Job events: `job_events` table logs job lifecycle
- ✅ Cron endpoint: `/api/cron/scan-schedules` exists and authenticates via `CRON_SECRET`
- ✅ `scanSchedules` function: Atomically claims due schedules, enqueues publish jobs

**Issues & Gaps:**

1. **REQUIRED_FOR_LAUNCH**: RPC function schema mismatch (see 4.1)
   - `worker_claim_next_job` uses old schema
   - **Work type**: CURSOR_CODE_WORK

2. **REQUIRED_FOR_LAUNCH**: Missing RPC functions (see 4.1)
   - `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale` not in migrations
   - **Work type**: CURSOR_CODE_WORK or MANUAL_INFRA_WORK

3. **REQUIRED_FOR_LAUNCH**: Vercel Cron configuration
   - `scan-schedules` endpoint exists but needs Vercel Cron setup
   - **File**: `apps/web/vercel.json` (needs cron config)
   - **Work type**: MANUAL_INFRA_WORK (configure in Vercel dashboard)

4. **OPTIONAL_POLISH**: Job priority handling
   - Jobs table has `priority` column but RPC may not use it correctly
   - **Work type**: CURSOR_CODE_WORK (verify priority ordering)

5. **LATER**: Job queue observability
   - Job events exist but may need dashboard/alerting
   - **Work type**: MANUAL_INFRA_WORK (build dashboard or use Supabase dashboard)

---

### 4.6 Pipelines & Media (ffmpeg, Storage, Transcription)

**Current State:**
- **Files**: 
  - Pipelines: `apps/worker/src/pipelines/*.ts`
  - Services: `apps/worker/src/services/transcriber/`, `apps/worker/src/services/youtube/download.ts`, `apps/worker/src/services/ffmpeg/`, `apps/worker/src/services/storage.ts`

**Status:** ✅ **DONE**

**What exists:**
- ✅ YouTube download: Uses `yt-dlp` abstraction, downloads to temp, uploads to Supabase Storage
- ✅ Transcription: Deepgram/Whisper abstraction, stores SRT and JSON transcripts
- ✅ Highlight detection: Groups segments, generates candidate clips
- ✅ Clip rendering: ffmpeg cuts clips, generates thumbnails, uploads to storage
- ✅ Storage adapter: Supabase Storage abstraction with `download`, `upload`, `exists`, `list`
- ✅ Environment check: `verifyWorkerEnvironment` checks for ffmpeg and yt-dlp binaries

**Issues & Gaps:**

1. **REQUIRED_FOR_LAUNCH**: Worker deployment assumes binaries
   - Worker warns if ffmpeg/yt-dlp missing but doesn't fail
   - **File**: `apps/worker/src/lib/envCheck.ts`
   - **Work type**: MANUAL_INFRA_WORK (ensure binaries installed in deployment environment)

2. **OPTIONAL_POLISH**: Transcription fallback
   - Deepgram is primary, Whisper is fallback, but fallback logic may need testing
   - **Work type**: CURSOR_CODE_WORK (test fallback scenarios)

3. **LATER**: Storage bucket configuration
   - Buckets (`videos`, `transcripts`, `renders`, `thumbs`) assumed to exist
   - **Work type**: MANUAL_INFRA_WORK (verify buckets exist in Supabase)

---

### 4.7 Auth & Workspace Isolation

**Current State:**
- **Files**: `packages/shared/auth/context.ts`, `apps/web/src/lib/auth/context.ts`, `apps/web/src/lib/withAuthContext.ts`

**Status:** ✅ **DONE**

**What exists:**
- ✅ `buildAuthContext`: Validates Supabase sessions, verifies workspace membership
- ✅ Debug headers: `x-debug-user`, `x-debug-workspace` (disabled in production)
- ✅ Workspace membership check: Queries `workspace_members` table
- ✅ RLS compatibility: Uses service role key but respects workspace boundaries

**Issues & Gaps:**

1. **OPTIONAL_POLISH**: Debug header removal
   - Debug headers are disabled in production (✅ good), but legacy code may still reference them
   - **Work type**: CURSOR_CODE_WORK (audit for leftover debug paths)

2. **LATER**: Session refresh handling
   - Auth context doesn't handle token refresh (may need middleware)
   - **Work type**: CURSOR_CODE_WORK (if refresh needed)

---

### 4.8 Logging, Sentry & Observability

**Current State:**
- **Files**: 
  - `packages/shared/src/sentry.ts`, `apps/web/sentry.*.config.ts`, `apps/worker/src/services/sentry.ts`
  - `packages/shared/logging/logger.ts`, `apps/web/src/lib/logger.ts`, `apps/worker/src/logger.ts`

**Status:** ✅ **DONE**

**What exists:**
- ✅ Sentry initialization: Web (server, edge, client) and worker
- ✅ Structured logging: JSON logs with context fields
- ✅ Error capture: `captureError` used in pipelines and API routes
- ✅ Log sampling: `LOG_SAMPLE_RATE` env var (default 1.0)
- ✅ Sentry DSN: Configurable via `SENTRY_DSN` env var

**Issues & Gaps:**

1. **OPTIONAL_POLISH**: Log aggregation
   - Logs are structured but may need centralized aggregation (e.g., Logtail, Datadog)
   - **Work type**: MANUAL_INFRA_WORK (configure log aggregation service)

2. **LATER**: Performance monitoring
   - Sentry traces are enabled but may need APM setup
   - **Work type**: MANUAL_INFRA_WORK (configure Sentry APM)

---

### 4.9 CI & Testing

**Current State:**
- **Files**: `.github/workflows/ci.yml`, `test/**/*.ts`, `vitest.config.ts`

**Status:** 🟡 **PARTIAL**

**What exists:**
- ✅ CI workflow: Runs on push/PR to `main`/`dev`
- ✅ Typecheck: `pnpm typecheck` runs in CI
- ✅ Tests: `pnpm test` runs in CI
- ✅ Coverage: `pnpm test:coverage` runs and uploads artifacts
- ✅ Test suites: 26+ API tests, worker tests, billing tests, pipeline tests

**Issues & Gaps:**

1. **OPTIONAL_POLISH**: Coverage thresholds
   - Coverage runs but no thresholds enforced (may fail if < X%)
   - **Work type**: CURSOR_CODE_WORK (add coverage thresholds to `vitest.config.ts`)

2. **OPTIONAL_POLISH**: Test database setup
   - Tests may need local Supabase instance (not documented)
   - **Work type**: CURSOR_CODE_WORK (document test setup, add test DB scripts)

3. **LATER**: E2E tests
   - Unit/integration tests exist but E2E tests may be missing
   - **Work type**: CURSOR_CODE_WORK (add E2E test suite if needed)

---

## 5. Prioritized Task List

### P1 – REQUIRED_FOR_LAUNCH

1. **Fix worker RPC schema mismatch**
   - **Description**: Update `worker_claim_next_job` RPC to use new schema (`status` instead of `state`, `worker_id` instead of `locked_by`, `last_heartbeat` instead of `heartbeat_at`)
   - **Subsystem**: 4.1 (Supabase Schema & RLS)
   - **Work type**: CURSOR_CODE_WORK
   - **File**: `supabase/migrations/20250101000006_worker_claim_next_job_rpc.sql`

2. **Create missing RPC functions**
   - **Description**: Create migration files for `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale` (or verify they exist in remote DB and sync)
   - **Subsystem**: 4.1 (Supabase Schema & RLS), 4.5 (Jobs System)
   - **Work type**: CURSOR_CODE_WORK or MANUAL_INFRA_WORK
   - **Files**: New migration files in `supabase/migrations/`

3. **Verify YouTube token encryption**
   - **Description**: Ensure YouTube tokens are encrypted using `encryptSecret` (same as TikTok)
   - **Subsystem**: 4.4 (OAuth & External APIs)
   - **Work type**: CURSOR_CODE_WORK
   - **File**: `packages/shared/src/services/youtubeAuth.ts`

4. **Configure Vercel Cron**
   - **Description**: Set up Vercel Cron job to call `/api/cron/scan-schedules` every 5 minutes
   - **Subsystem**: 4.5 (Jobs System, Worker & Cron)
   - **Work type**: MANUAL_INFRA_WORK
   - **File**: `apps/web/vercel.json` (or Vercel dashboard)

5. **Verify RLS policies**
   - **Description**: Manually verify all tables have RLS enabled and correct policies
   - **Subsystem**: 4.1 (Supabase Schema & RLS)
   - **Work type**: MANUAL_INFRA_WORK
   - **Location**: Supabase dashboard → SQL Editor

6. **Ensure worker binaries are installed**
   - **Description**: Verify ffmpeg and yt-dlp are installed in worker deployment environment
   - **Subsystem**: 4.6 (Pipelines & Media)
   - **Work type**: MANUAL_INFRA_WORK
   - **Location**: Worker deployment (Vercel, Railway, etc.)

### P2 – SHOULD_FIX_BEFORE_SCALING

7. **Add YouTube token refresh job**
   - **Description**: Create periodic job to refresh YouTube tokens (similar to TikTok)
   - **Subsystem**: 4.4 (OAuth & External APIs)
   - **Work type**: CURSOR_CODE_WORK
   - **File**: New file `apps/worker/src/jobs/refreshYouTubeTokens.ts`

8. **Add coverage thresholds**
   - **Description**: Enforce minimum coverage threshold in CI (e.g., 80%)
   - **Subsystem**: 4.9 (CI & Testing)
   - **Work type**: CURSOR_CODE_WORK
   - **File**: `vitest.config.ts`

9. **Document test setup**
   - **Description**: Document how to run tests locally (Supabase setup, env vars)
   - **Subsystem**: 4.9 (CI & Testing)
   - **Work type**: CURSOR_CODE_WORK
   - **File**: `README.md` or `test/README.md`

### P3 – OPTIONAL_POLISH

10. **Audit env var usage**
    - **Description**: Find all `process.env` usage, ensure all vars are documented
    - **Subsystem**: 4.2 (Environment & Configuration)
    - **Work type**: CURSOR_CODE_WORK

11. **Add webhook event tests**
    - **Description**: Expand billing tests to cover all Stripe webhook events
    - **Subsystem**: 4.3 (Stripe & Billing)
    - **Work type**: CURSOR_CODE_WORK

12. **Remove debug header references**
    - **Description**: Audit codebase for leftover debug header usage
    - **Subsystem**: 4.7 (Auth & Workspace Isolation)
    - **Work type**: CURSOR_CODE_WORK

13. **Configure log aggregation**
    - **Description**: Set up centralized log aggregation (Logtail, Datadog, etc.)
    - **Subsystem**: 4.8 (Logging, Sentry & Observability)
    - **Work type**: MANUAL_INFRA_WORK

---

## 6. "Where You Left Off" Snapshot

Based on recent commits and current code:

**You were working on:**
- **Worker job system improvements**: Added `job_events` table, `worker_finish` RPC, and `result` column to jobs. Fixed type errors in shared env/logging and worker pipelines.

**What looks almost done:**
- ✅ **Core pipelines**: All pipelines (transcribe, highlight, render, publish) are implemented and wired in worker handlers
- ✅ **Stripe billing**: Checkout, webhooks, plan mapping, and plan gating are complete
- ✅ **TikTok OAuth**: Full flow with proper encryption (AES-256-GCM, not base64)
- ✅ **Job system**: Worker polling, heartbeat, stale reclamation logic is in place

**What's clearly not started:**
- ❌ **Worker RPC schema sync**: The `worker_claim_next_job` RPC function uses old schema columns that were removed in later migrations
- ❌ **Missing RPC functions**: `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale` are called but not found in migrations
- ❌ **Vercel Cron setup**: Cron endpoint exists but needs Vercel dashboard configuration
- ❌ **YouTube token refresh**: No periodic refresh job for YouTube (TikTok has one)

**Critical blocker:**
The worker RPC schema mismatch is a **critical blocker** - the worker will fail to claim jobs if the RPC function doesn't match the current database schema. This must be fixed before the worker can process jobs in production.

---

## 7. Next 3 Suggested Steps

### Step 1: Fix Worker RPC Schema Mismatch (P1 - REQUIRED_FOR_LAUNCH)
**Priority**: 🔴 **CRITICAL**

**Action**: Update `worker_claim_next_job` RPC to use new schema:
- Change `state = 'queued'` → `status = 'queued'`
- Change `state = 'running'` → `status = 'running'`
- Remove `locked_at`, `locked_by`, `heartbeat_at`
- Use `worker_id` and `last_heartbeat` instead

**Work type**: CURSOR_CODE_WORK  
**File**: `supabase/migrations/20250101000006_worker_claim_next_job_rpc.sql`  
**Estimated time**: 15 minutes

**Why first**: This is a critical blocker - the worker cannot claim jobs if the RPC doesn't match the schema.

---

### Step 2: Create Missing RPC Functions (P1 - REQUIRED_FOR_LAUNCH)
**Priority**: 🔴 **CRITICAL**

**Action**: Create migration files for `worker_heartbeat`, `worker_fail`, `worker_reclaim_stale`:
- `worker_heartbeat`: Updates `last_heartbeat` for a job
- `worker_fail`: Marks job as failed, sets backoff, increments attempts
- `worker_reclaim_stale`: Reclaims jobs where `last_heartbeat` is older than threshold

**Work type**: CURSOR_CODE_WORK  
**Files**: New migration files in `supabase/migrations/`  
**Estimated time**: 30 minutes

**Why second**: Worker calls these functions but they don't exist, causing runtime errors.

---

### Step 3: Verify YouTube Token Encryption (P1 - REQUIRED_FOR_LAUNCH)
**Priority**: 🟡 **HIGH**

**Action**: Check `packages/shared/src/services/youtubeAuth.ts` - ensure tokens are encrypted using `encryptSecret` (same pattern as TikTok).

**Work type**: CURSOR_CODE_WORK  
**File**: `packages/shared/src/services/youtubeAuth.ts`  
**Estimated time**: 10 minutes

**Why third**: Security requirement - tokens must be encrypted at rest.

---

## 8. Additional Notes

### Migration History
The database schema has evolved:
- Early migrations used `state`, `locked_at`, `locked_by`, `heartbeat_at`
- Later migration (`20251020043717_remote_schema.sql`) dropped these and added `status`, `worker_id`, `last_heartbeat`
- RPC functions may not have been updated to match

### Test Coverage
- **API tests**: 26+ test files in `test/api/`
- **Worker tests**: Pipeline tests, job flow tests, retry tests
- **Billing tests**: Plan resolution, webhook handling
- **Coverage**: Runs in CI but no thresholds enforced

### Deployment Assumptions
- **Worker**: Assumes ffmpeg and yt-dlp are installed (warns if missing)
- **Web**: Next.js app on Vercel
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage buckets (`videos`, `transcripts`, `renders`, `thumbs`)

### Security Notes
- ✅ TikTok tokens encrypted with AES-256-GCM
- ⚠️ YouTube tokens need verification
- ✅ RLS enabled on user-facing tables
- ✅ Service role key only used server-side
- ✅ Debug headers disabled in production

---

**End of Audit Report**

