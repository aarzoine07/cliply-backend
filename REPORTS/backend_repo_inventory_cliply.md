# Cliply Backend Repo Inventory – Layer A

**Timestamp:** 2025-01-XX  
**Branch:** `backend-readiness-v1`  
**Purpose:** Descriptive inventory of what exists in the Cliply backend repository and where it is located.

---

## High-Level Overview

### Architecture Summary

The Cliply backend is a **pnpm monorepo** implementing a SaaS platform for automated video clip generation and multi-platform publishing. The architecture follows a clear separation:

- **API Layer** (`apps/web`): Next.js application serving both web UI and API routes
- **Worker Layer** (`apps/worker`): Background job processor executing pipelines (transcription, clip generation, publishing)
- **Shared Package** (`packages/shared`): Common types, schemas, billing logic, logging, and utilities
- **Database** (`supabase/migrations`): PostgreSQL schema with 59 migrations, RLS policies, and helper functions
- **Tests** (`test/`): Comprehensive test suites organized by domain

### High-Level Data Flow

```
User Request → API (apps/web) → Job Queue (Supabase jobs table)
                                      ↓
                              Worker (apps/worker) → Pipeline Execution
                                      ↓
                              Storage (Supabase Storage) → External APIs (TikTok/YouTube)
```

**Pipeline Flow:**
1. **Ingestion**: User uploads video URL → `YOUTUBE_DOWNLOAD` job → Video stored
2. **Transcription**: `TRANSCRIBE` job → Transcript JSON/SRT generated
3. **Highlight Detection**: `HIGHLIGHT_DETECT` job → Clips proposed
4. **Rendering**: `CLIP_RENDER` job → Rendered clips stored
5. **Publishing**: `PUBLISH_TIKTOK` / `PUBLISH_YOUTUBE` job → Posted to platforms

---

## Module Inventory

### `apps/web/` – API & Web Application

**Purpose:** Next.js application providing both frontend pages and backend API routes.

**Key Submodules:**

- **`src/pages/api/`** – API route handlers:
  - `upload/init.ts`, `upload/complete.ts` – Video upload initialization and completion
  - `clips/[id]/approve.ts`, `clips/[id]/reject.ts`, `clips/[id]/meta.ts` – Clip management
  - `projects/[id].ts` – Project details
  - `jobs/[id].ts`, `jobs/search.ts`, `jobs/enqueue.ts` – Job management
  - `publish/tiktok.ts`, `publish/youtube.ts` – Publishing endpoints
  - `billing/checkout.ts`, `billing/status.ts`, `billing/usage.ts` – Billing APIs
  - `accounts/index.ts`, `accounts/[id].ts`, `accounts/publish.ts` – Connected account management
  - `cron/scan-schedules.ts` – Scheduled post scanning
  - `schedules/index.ts`, `schedules/[id]/cancel.ts` – Schedule management
  - `webhooks/stripe.ts` – Stripe webhook handler
  - `health.ts`, `healthz.ts`, `readyz.ts` – Health and readiness endpoints
  - `admin/readyz.ts` – Admin readiness endpoint
  - `oauth/tiktok/start.ts`, `oauth/tiktok/callback.ts` – TikTok OAuth flow
  - `oauth/google/start.ts`, `oauth/google/callback.ts` – Google/YouTube OAuth flow (stub)
  - `viral/experiments.ts`, `viral/metrics.ts` – Viral experiment APIs
  - `dropshipping/` – Dropshipping product and creative APIs

- **`src/app/api/`** – App router API routes:
  - `auth/tiktok/connect/callback/route.ts` – TikTok OAuth callback (App Router)

- **`src/lib/`** – Core libraries:
  - `auth.ts`, `auth/context.ts` – Authentication and workspace validation
  - `billing/` – Billing service integration
  - `accounts/` – Connected account service
  - `enqueueJob.ts` – Job enqueueing with idempotency
  - `rate-limit.ts`, `withRateLimit.ts` – Rate limiting middleware
  - `withPlanGate.ts` – Plan-based feature gating
  - `idempotency.ts` – Idempotency helpers
  - `storage.ts` – Storage operations
  - `youtube.ts` – YouTube service helpers
  - `viral/` – Viral experiment orchestration
  - `dropshipping/` – Dropshipping services
  - `logger.ts` – Logging utilities
  - `sentry.ts` – Sentry integration
  - `supabase.ts` – Supabase client helpers

- **`src/middleware/`** – Request middleware:
  - `require-auth.ts` – Authentication requirement
  - `validateWorkspaceHeader.ts` – Workspace header validation
  - `with-idempotency.ts` – Idempotency middleware
  - `with-rate-limit.ts` – Rate limiting middleware

- **`test/`** – Web app tests:
  - `api/` – API route tests (health, readyz, billing, publish, upload, etc.)
  - `auth.debug-header-smoke.test.ts` – Auth smoke tests
  - `jobs.*.test.ts` – Job-related tests
  - `lib/` – Library tests (env, idempotency, storage)

**Key Files:**
- `package.json` – Next.js app dependencies
- `next.config.cjs` – Next.js configuration
- `sentry.*.config.ts` – Sentry configuration files
- `vercel.json` – Vercel deployment configuration

---

### `apps/worker/` – Background Job Processor

**Purpose:** Polls Supabase `jobs` table and executes pipeline stages.

**Key Submodules:**

- **`src/worker.ts`** – Main worker loop:
  - Polls for jobs via `worker_claim_next_job` RPC
  - Heartbeat mechanism
  - Stale job reclamation
  - Job handler routing

- **`src/pipelines/`** – Pipeline implementations:
  - `youtube-download.ts` – Downloads YouTube videos using yt-dlp
  - `transcribe.ts` – Transcribes videos (Deepgram/Whisper)
  - `highlight-detect.ts` – Detects highlight segments from transcripts
  - `clip-render.ts` – Renders clips using FFmpeg
  - `thumbnail.ts` – Generates thumbnails
  - `publish-youtube.ts` – Publishes to YouTube (partially stubbed)
  - `publish-tiktok.ts` – Publishes to TikTok (fully implemented)

- **`src/services/`** – Service integrations:
  - `transcriber/` – Transcription service abstraction
  - `ffmpeg/` – FFmpeg command building and execution
  - `youtube/client.ts` – YouTube API client (stubbed)
  - `tiktok/client.ts` – TikTok API client (implemented)
  - `viral/` – Viral experiment services
  - `storage/` – Storage operations

- **`src/jobs/`** – Background jobs:
  - `claim.ts` – Job claiming logic
  - `backoff.ts` – Exponential backoff calculation
  - `initRateLimits.ts` – Rate limit initialization
  - `refreshTikTokTokens.ts` – TikTok token refresh
  - `syncSubscriptions.ts` – Stripe subscription sync

- **`src/lib/`** – Worker utilities:
  - `envCheck.ts` – Environment validation
  - `ffmpegSafe.ts` – Safe FFmpeg execution with timeouts
  - `jobAdmin.ts` – Job administration helpers
  - `tempCleanup.ts` – Temporary file cleanup

- **`test/`** – Worker tests:
  - `worker.*.test.ts` – Worker lifecycle tests
  - `pipelines.*.test.ts` – Pipeline tests
  - `jobs.*.test.ts` – Job flow tests
  - `dead-letter-queue.test.ts` – DLQ tests
  - `logging.*.test.ts` – Logging tests

**Key Files:**
- `package.json` – Worker dependencies
- `src/readyz.ts` – Worker readiness checks
- `src/db.ts` – Database connection

---

### `packages/shared/` – Shared Package

**Purpose:** Common TypeScript code used by both web and worker.

**Key Submodules:**

- **`src/env.ts`** – Environment variable schema (Zod):
  - Centralized validation
  - Type-safe access
  - Test mode support (no caching)

- **`src/billing/`** – Billing and usage tracking:
  - `planMatrix.ts` – Plan definitions (basic, pro, premium)
  - `planGate.ts` – Plan-based feature gating
  - `usageTracker.ts` – Usage tracking and limits
  - `checkRateLimit.ts` – Rate limit checking
  - `rateLimitConfig.ts` – Rate limit configuration
  - `stripePlanMap.ts` – Stripe product/price mapping
  - `status.ts` – Billing status resolution

- **`src/engine/`** – Engine internals:
  - `pipelineStages.ts` – Pipeline stage definitions
  - `postingGuard.ts` – Anti-spam posting limits
  - `clipOverlap.ts` – Clip overlap detection
  - `clipCount.ts` – Clip counting logic
  - `videoInput.ts` – Video URL parsing and validation

- **`src/schemas/`** – Zod schemas:
  - `jobs.ts` – Job payload schemas
  - `upload.ts` – Upload request schemas
  - `accounts.ts` – Account schemas
  - `dropshipping.ts` – Dropshipping schemas
  - `viral.ts` – Viral experiment schemas

- **`src/health/`** – Health and readiness:
  - `engineHealthSnapshot.ts` – Engine health aggregation
  - `readyChecks.ts` – Readiness check implementations

- **`src/readiness/`** – Backend readiness:
  - `backendReadiness.ts` – Comprehensive readiness reporting

- **`src/logging/`** – Logging:
  - `logger.ts` – Structured JSON logging
  - `auditLogger.ts` – Audit event logging
  - `redactSensitive.ts` – Secret redaction

- **`src/services/`** – Service integrations:
  - `tiktokAuth.ts` – TikTok OAuth token management
  - `youtubeAuth.ts` – YouTube OAuth token management

- **`src/db/`** – Database types:
  - `connected-account.ts` – Connected account types
  - `connected-account-access.ts` – Account access helpers

- **`src/crypto/`** – Cryptography:
  - `encryptedSecretEnvelope.ts` – Encrypted secret storage

- **`src/idempotency/`** – Idempotency:
  - `idempotencyHelper.ts` – Idempotency key management

- **`src/errors/`** – Error handling:
  - `video.ts` – Video-specific errors

- **`src/observability/`** – Observability:
  - `logging.ts` – Observability logging helpers

- **`src/resilience/`** – Resilience:
  - `externalServiceResilience.ts` – External service error handling

- **`src/storage/`** – Storage:
  - `paths.ts` – Storage path utilities

- **`src/sentry.ts`** – Sentry initialization

- **`test/`** – Shared tests:
  - `envSchema.test.ts` – Env schema tests
  - `crypto/encryptedSecretEnvelope.test.ts` – Crypto tests

**Key Files:**
- `package.json` – Shared package dependencies
- `tsup.config.ts` – Build configuration
- `index.ts` – Public API exports

---

### `supabase/` – Database Schema & Migrations

**Purpose:** PostgreSQL database schema, migrations, and RLS policies.

**Key Components:**

- **`migrations/`** – 59 SQL migration files:
  - `20250101000000_rls_workspaces_members.sql` – Workspace and membership RLS
  - `20250101000001_jobs_table.sql` – Jobs table creation
  - `20251020043717_remote_schema.sql` – Remote schema baseline (large migration)
  - `20251123000000_workspace_usage.sql` – Usage tracking table
  - `20251124000000_add_publish_config.sql` – Publishing configuration
  - `20251126000000_add_plan_to_workspaces.sql` – Plan assignment
  - `20251127000000_dropshipping_products.sql` – Dropshipping schema
  - `20251130000000_dropshipping_actions.sql` – Dropshipping actions
  - `20251201010000_fix_workspace_membership_helper.sql` – RLS helper fixes
  - `20251210163500_jobs_rls_stabilization.sql` – Jobs RLS stabilization
  - And 49 more migrations...

- **`config.toml`** – Supabase configuration

- **`seed/seed.sql`** – Seed data

**Key Tables:**
- `workspaces` – Workspace definitions
- `workspace_members` – User-workspace membership
- `projects` – Video source projects
- `clips` – Generated clips
- `jobs` – Job queue
- `connected_accounts` – OAuth-connected social accounts
- `subscriptions` – Stripe subscription records
- `workspace_usage` – Usage tracking per period
- `rate_limits` – Rate limit buckets
- `schedules` – Scheduled posts
- `experiments`, `experiment_variants`, `variant_posts`, `variant_metrics` – Viral experiment tables
- `products`, `clip_products`, `dropshipping_actions` – Dropshipping tables
- `events`, `events_audit` – Event logging
- `idempotency_keys` – Idempotency tracking

**RLS Policies:**
- All tables have RLS enabled
- Service-role bypass policies for workers
- Workspace-member access policies using `is_workspace_member()` helper
- See `REPORTS/rls_posture_backend-readiness-v1.md` for detailed RLS analysis

---

### `test/` – Test Suites

**Purpose:** Comprehensive test coverage organized by domain.

**Key Test Modules:**

- **`api/`** – API endpoint tests:
  - `healthz.test.ts`, `readyz.test.ts`, `admin.readyz.test.ts` – Health tests
  - `accounts.*.test.ts` – Account management tests
  - `billing.*.test.ts` – Billing tests
  - `publish.*.test.ts` – Publishing tests
  - `upload.*.test.ts` – Upload tests
  - `webhooks.stripe.test.ts` – Stripe webhook tests
  - `viral.*.test.ts` – Viral experiment tests
  - `dropshipping.*.test.ts` – Dropshipping tests

- **`worker/`** – Worker tests:
  - `dead-letter-queue.test.ts` – DLQ tests
  - `pipelines.*.test.ts` – Pipeline tests
  - `worker.*.test.ts` – Worker lifecycle tests

- **`shared/`** – Shared package tests:
  - `engineHealthSnapshot.test.ts` – Health snapshot tests
  - `usageTracker.posts.test.ts` – Usage tracking tests
  - `videoInput.test.ts` – Video input validation tests

- **`rls/`** – RLS policy tests:
  - `jobs.rls.test.ts` – Jobs RLS tests (currently skipped)

- **`engine/`** – Engine tests:
  - `clipCount.test.ts`, `clipOverlap.test.ts` – Clip logic tests
  - `postingGuard.test.ts` – Posting guard tests
  - `full-pipeline.e2e.test.ts`, `pipeline-flow-simple.e2e.test.ts` – E2E pipeline tests

- **`billing/`** – Billing tests:
  - `resolveWorkspacePlan.test.ts` – Plan resolution tests

- **`services/`** – Service tests:
  - `youtubeAuth.test.ts` – YouTube auth tests

- **`observability/`** – Observability tests:
  - `logging.test.ts` – Logging tests

- **`admin/`** – Admin tests:
  - `readyz.test.ts` – Admin readiness tests

- **`db/`** – Database tests:
  - `rls.test.sql`, `workspace_membership.test.sql` – SQL-based tests

**Test Scripts:**
- `pnpm test:core` – Core backend tests (health, readiness, shared)
- `pnpm test` – Full test suite
- `pnpm test:coverage` – Coverage report

---

### `REPORTS/` – Documentation & Analysis

**Purpose:** Design documents, audits, and runbooks.

**Key Reports:**

- **Readiness & Audits:**
  - `backend_readiness_audit_integrate_engine_surface_v1.md` – Comprehensive readiness audit
  - `backend_readiness_discovery_backend-readiness-v1.md` – Readiness discovery
  - `backend_env_readiness.md` – Environment readiness guide
  - `rls_posture_backend-readiness-v1.md` – RLS security posture

- **Engine Reliability (ER-*):**
  - `ER-00-engine-reliability-discovery.md` – Engine reliability discovery
  - `ER-01-pipeline-checkpoints-complete.md` – Pipeline checkpoints
  - `ER-04-engine-health-snapshot-complete.md` – Health snapshot
  - `ER-05-engine-e2e-harness-complete.md` – E2E test harness
  - `ER-06-admin-tooling-complete.md` – Admin tooling

- **Engine Integration (EI-*):**
  - `EI-02-clip-overlap-consolidation-complete.md` – Clip overlap
  - `EI-03-posting-anti-spam-guard-complete.md` – Anti-spam guard
  - `EI-04B-billing-cleanup-and-tests-complete.md` – Billing cleanup
  - `EI-05-storage-cleanup-complete.md` – Storage cleanup
  - `EI-05B-billing-types-module-complete.md` – Billing types

- **Operations:**
  - `backend_ops_runbook.md` – Operations runbook
  - `backend_state.md` – Backend state documentation

---

### `scripts/` – Utility Scripts

**Purpose:** Development and operations scripts.

**Key Scripts:**

- **Environment:**
  - `check-env.ts` – Environment validation
  - `check-env-template-sync.ts` – Env template sync check

- **Readiness:**
  - `backend.readiness.ts` – Backend readiness check

- **Database:**
  - `db/apply-sql.ts` – SQL application

- **Jobs:**
  - `jobs/stats.ts` – Job statistics
  - `jobs/status.ts` – Job status

- **DLQ:**
  - `dlq/list.ts` – List DLQ jobs
  - `dlq/inspect.ts` – Inspect DLQ job
  - `dlq/requeue.ts` – Requeue DLQ job

- **Workers:**
  - `workers/status.ts` – Worker status

- **Testing:**
  - `mint-test-jwts.mjs` – JWT generation for tests

---

## Capabilities to Modules Mapping

### A. Multi-tenant & Multi-account

**Modules:**
- `supabase/migrations/*_workspaces*.sql` – Workspace schema
- `supabase/migrations/*_workspace_members*.sql` – Membership schema
- `apps/web/src/middleware/validateWorkspaceHeader.ts` – Workspace validation
- `apps/web/src/lib/auth/context.ts` – Auth context with workspace
- `apps/web/src/pages/api/accounts/` – Account management APIs
- `packages/shared/src/db/connected-account.ts` – Account types

**Tests:**
- `test/api/accounts.test.ts` – Account tests
- `test/db/workspace_membership.test.sql` – Membership tests

---

### B. Long-form Ingestion → Clips Pipeline

**Modules:**
- `apps/web/src/pages/api/upload/init.ts` – Upload initiation
- `apps/worker/src/pipelines/youtube-download.ts` – Video download
- `apps/worker/src/pipelines/transcribe.ts` – Transcription
- `apps/worker/src/pipelines/highlight-detect.ts` – Highlight detection
- `apps/worker/src/pipelines/clip-render.ts` – Clip rendering
- `packages/shared/src/engine/videoInput.ts` – Video URL parsing
- `packages/shared/src/engine/pipelineStages.ts` – Pipeline stage definitions

**Tests:**
- `test/engine/full-pipeline.e2e.test.ts` – E2E pipeline tests
- `test/worker/pipelines.*.test.ts` – Pipeline unit tests
- `test/shared/videoInput.test.ts` – Video input tests

---

### C. Clip Management

**Modules:**
- `apps/web/src/pages/api/clips/[id]/approve.ts` – Clip approval
- `apps/web/src/pages/api/clips/[id]/reject.ts` – Clip rejection
- `apps/web/src/pages/api/clips/[id]/meta.ts` – Clip metadata
- `supabase/migrations/*_clips*.sql` – Clips table schema

**Tests:**
- `test/api/clips.edge-cases.test.ts` – Clip edge case tests

---

### D. Multi-account Posting Engine

**Modules:**
- `apps/web/src/pages/api/publish/tiktok.ts` – TikTok publish API
- `apps/web/src/pages/api/publish/youtube.ts` – YouTube publish API
- `apps/worker/src/pipelines/publish-tiktok.ts` – TikTok publishing pipeline
- `apps/worker/src/pipelines/publish-youtube.ts` – YouTube publishing pipeline
- `apps/worker/src/services/tiktok/client.ts` – TikTok API client
- `apps/worker/src/services/youtube/client.ts` – YouTube API client (stubbed)
- `apps/web/src/pages/api/accounts/publish.ts` – Account selection for publishing

**Tests:**
- `test/api/publish.tiktok.test.ts`, `test/api/publish.tiktok.e2e.test.ts` – TikTok publish tests
- `test/api/publish.youtube.test.ts` – YouTube publish tests
- `test/worker/publish-tiktok.pipeline.test.ts` – TikTok pipeline tests

---

### E. Scheduling & Anti-spam

**Modules:**
- `apps/web/src/pages/api/schedules/` – Schedule management
- `apps/web/src/pages/api/cron/scan-schedules.ts` – Schedule scanning cron
- `packages/shared/src/engine/postingGuard.ts` – Anti-spam posting guard
- `supabase/migrations/*_schedules*.sql` – Schedules table

**Tests:**
- `test/api/cron.scan-schedules.test.ts` – Schedule scanning tests
- `test/api/cron.schedules.edge-cases.test.ts` – Schedule edge cases
- `test/engine/postingGuard.test.ts` – Posting guard tests

---

### F. Usage & Billing

**Modules:**
- `packages/shared/src/billing/planMatrix.ts` – Plan definitions
- `packages/shared/src/billing/usageTracker.ts` – Usage tracking
- `packages/shared/src/billing/planGate.ts` – Plan gating
- `apps/web/src/pages/api/billing/` – Billing APIs
- `apps/web/src/pages/api/webhooks/stripe.ts` – Stripe webhooks
- `apps/worker/src/jobs/syncSubscriptions.ts` – Subscription sync
- `supabase/migrations/*_subscriptions*.sql` – Subscriptions table
- `supabase/migrations/*_workspace_usage*.sql` – Usage tracking table

**Tests:**
- `test/api/billing.*.test.ts` – Billing tests
- `test/api/webhooks.stripe.test.ts` – Stripe webhook tests
- `test/shared/usageTracker.posts.test.ts` – Usage tracking tests
- `test/billing/resolveWorkspacePlan.test.ts` – Plan resolution tests

---

### G. Reliability & Recovery

**Modules:**
- `apps/web/src/pages/api/healthz.ts` – Liveness endpoint
- `apps/web/src/pages/api/readyz.ts` – Readiness endpoint
- `apps/web/src/pages/api/admin/readyz.ts` – Admin readiness
- `packages/shared/src/health/engineHealthSnapshot.ts` – Health snapshot
- `packages/shared/src/readiness/backendReadiness.ts` – Readiness reporting
- `apps/worker/src/readyz.ts` – Worker readiness
- `apps/worker/src/jobs/backoff.ts` – Retry backoff
- `apps/worker/src/scripts/recoverStuckJobs.ts` – Stuck job recovery
- `scripts/dlq/` – DLQ management scripts

**Tests:**
- `test/api/healthz.test.ts` – Health endpoint tests
- `test/api/readyz.test.ts` – Readiness tests
- `test/admin/readyz.test.ts` – Admin readiness tests
- `test/shared/engineHealthSnapshot.test.ts` – Health snapshot tests
- `test/worker/dead-letter-queue.test.ts` – DLQ tests

**Runbooks:**
- `REPORTS/backend_ops_runbook.md` – Operations runbook

---

### H. Security, Auth, and RLS

**Modules:**
- `apps/web/src/lib/auth.ts` – Authentication helpers
- `apps/web/src/middleware/require-auth.ts` – Auth middleware
- `supabase/migrations/*_rls*.sql` – RLS policies
- `packages/shared/src/crypto/encryptedSecretEnvelope.ts` – Secret encryption
- `packages/shared/src/services/tiktokAuth.ts` – TikTok token encryption

**Tests:**
- `test/rls/jobs.rls.test.ts` – RLS tests (currently skipped)
- `test/db/rls.test.sql` – RLS SQL tests

**Reports:**
- `REPORTS/rls_posture_backend-readiness-v1.md` – RLS posture analysis

---

### I. Observability & Logging

**Modules:**
- `packages/shared/src/logging/logger.ts` – Structured logging
- `packages/shared/src/logging/auditLogger.ts` – Audit logging
- `packages/shared/src/sentry.ts` – Sentry initialization
- `apps/web/sentry.*.config.ts` – Sentry configuration
- `apps/worker/src/services/sentry.ts` – Worker Sentry adapter

**Tests:**
- `test/observability/logging.test.ts` – Logging tests
- `test/worker/logging.*.test.ts` – Worker logging tests

---

### J. Operations, CI/CD, Deployments

**Modules:**
- `.github/workflows/ci.yml` – CI pipeline
- `package.json` – Scripts: `test:core`, `check:env`, `check:env:template`, `backend:readyz`
- `scripts/check-env.ts` – Environment validation
- `scripts/backend.readiness.ts` – Readiness check

**Documentation:**
- `REPORTS/backend_env_readiness.md` – Environment readiness guide
- `ENV.md` – Environment variable documentation

---

### K. Licensing & Dependency Risk

**Modules:**
- `package.json` (root, apps/*, packages/*) – Dependency declarations
- No LICENSE file found at repo root (only in `_supabase_cli/`)

---

## Env & Config Inventory

### Environment Schema (`packages/shared/src/env.ts`)

**Required Variables (3):**
- `NODE_ENV` (defaults to "development")
- `SUPABASE_URL` (validated as URL)
- `SUPABASE_ANON_KEY` (min 20 chars)
- `SUPABASE_SERVICE_ROLE_KEY` (min 20 chars)

**Optional but Important (23):**
- **Worker Config:** `WORKER_POLL_MS`, `WORKER_HEARTBEAT_MS`, `WORKER_RECLAIM_MS`, `WORKER_STALE_SECONDS`, `LOG_SAMPLE_RATE`
- **External Services:** `SENTRY_DSN`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`
- **YouTube OAuth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_OAUTH_REDIRECT_URL`
- **TikTok OAuth:** `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_OAUTH_REDIRECT_URL`, `TIKTOK_TOKEN_URL`, `TIKTOK_ENCRYPTION_KEY`
- **Cron/Automation:** `CRON_SECRET`, `VERCEL_AUTOMATION_BYPASS_SECRET`
- **Next.js Public:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TIKTOK_REDIRECT_URL`, `NEXT_PUBLIC_YOUTUBE_REDIRECT_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SENTRY_DSN`

**Env Validation:**
- `pnpm check:env` – Validates API and Worker requirements
- `pnpm check:env:template` – Ensures `.env.example` sync with schema

---

## Known Design Docs

### Existing Reports Index

**Readiness & Audits:**
- `backend_readiness_audit_integrate_engine_surface_v1.md` – Comprehensive readiness audit (72/100 score)
- `backend_readiness_discovery_backend-readiness-v1.md` – Readiness discovery
- `backend_env_readiness.md` – Environment readiness guide
- `rls_posture_backend-readiness-v1.md` – RLS security posture (🟡 YELLOW overall)

**Engine Reliability (ER-*):**
- `ER-00-engine-reliability-discovery.md` – Engine reliability discovery
- `ER-01-pipeline-checkpoints-complete.md` – Pipeline checkpoints implementation
- `ER-04-engine-health-snapshot-complete.md` – Health snapshot implementation
- `ER-05-engine-e2e-harness-complete.md` – E2E test harness
- `ER-06-admin-tooling-complete.md` – Admin tooling

**Engine Integration (EI-*):**
- `EI-02-clip-overlap-consolidation-complete.md` – Clip overlap consolidation
- `EI-03-posting-anti-spam-guard-complete.md` – Anti-spam guard implementation
- `EI-04B-billing-cleanup-and-tests-complete.md` – Billing cleanup
- `EI-05-storage-cleanup-complete.md` – Storage cleanup
- `EI-05B-billing-types-module-complete.md` – Billing types module

**Operations:**
- `backend_ops_runbook.md` – Operations runbook (health, readiness, DLQ, troubleshooting)
- `backend_state.md` – Backend state documentation

**Other Docs:**
- `docs/backend_v1_audit.md` – Backend v1 audit (detailed gap analysis)
- `docs/cliply_v1_backend_spec.md` – Backend specification
- `ENV.md` – Environment variable documentation
- `SENTRY_SETUP.md` – Sentry setup guide

---

## Summary

This inventory documents the current state of the Cliply backend repository. The codebase is well-organized with clear separation of concerns:

- **59 database migrations** with comprehensive RLS policies
- **Comprehensive test coverage** across API, worker, and shared modules
- **Structured logging and observability** with Sentry integration
- **Billing and usage tracking** with Stripe integration
- **Multi-tenant architecture** with workspace-based isolation
- **Pipeline-based job processing** with retry and DLQ support

The repository shows evidence of active development with multiple readiness audits, engine reliability improvements, and comprehensive documentation.

---

**End of Inventory Report**

