# Backend Readiness Discovery Report

**Run #1 – 2025-12-10 20:39 UTC**  
**Git Branch:** `backend-readiness-v1`  
**Git Commit:** `2778e6d63937faf74f4c002c406bfbf5334b07f7`  
**Node Version:** v22.17.0  
**pnpm Version:** 10.24.0

---

## High-Level Summary

### Overall Readiness Posture: **🟢 GREEN** (Critical blockers resolved; remaining medium/low priority work exists for RLS stabilization and documentation)

**Key Findings:**

- ✅ **Strong Foundation**: Centralized env schema, comprehensive test coverage (50+ tests passing), engine health snapshot implemented, DLQ logic in place
- ✅ **Resolved (T1)**: Type mismatch in readiness endpoints fixed - canonicalization work completed (T2 phases already completed)
- ⚠️ **Multiple Health Endpoints**: 6+ different health/readiness endpoints with inconsistent implementations and response shapes
- ✅ **Engine Internals**: Solid implementation of jobs, worker, DLQ, health snapshot with good test coverage
- ✅ **Supabase Schema**: 58 migrations, RLS enabled on core tables, service role policies in place
- ⚠️ **RLS Policy Instability**: Multiple iterations of RLS policies for jobs table suggest ongoing refinement
- ✅ **Env Schema**: Well-structured, type-safe, with validation and documentation

**Immediate "Must Fix Soon" Items:**

1. **⚠️ MEDIUM (Person 2)**: Stabilize RLS policies for jobs table - consolidate 4 policy iterations into one (T7)
2. **⚠️ MEDIUM (Person 1)**: Add RLS integration tests for edge cases (cross-workspace, service role) (T8)
3. **⚠️ LOW (Person 1)**: Standardize health endpoint response shapes - define common health response type (T9)
4. **⚠️ LOW (Person 1)**: Document RLS policy strategy and service role usage (T10)

---

## Status Update (2025-12-14)

**Status Update Proof (2025-12-14)**

Current HEAD: `f79c366`

Latest commit lines for key readiness-related paths:

- `apps/web/src/pages/api/readyz.ts`: `8818540 feat(health): align readyz/admin readyz to canonical response contracts (T2-01)`
- `apps/web/src/pages/api/admin/readyz.ts`: `8818540 feat(health): align readyz/admin readyz to canonical response contracts (T2-01)`
- `apps/web/vitest.config.ts`: `6341315 chore(test): include test/worker in apps/web vitest config (T5)`
- `apps/web/test/api/readyz.integration.test.ts`: `488a206 test(readiness): add integration tests for healthz/readyz/admin readyz (T6)`

Integration tests: T6 completed - integration tests exist for healthz/readyz/admin readyz endpoints.

**Note**: T1, T2, T3, T4, T5, T6 are now completed. See task table (Section E) for current status. All critical blockers have been resolved.

---

## Section A – Readiness & Health Model

### Endpoint Inventory

| Path | Method | Status Semantics | Response Schema Summary | Notes |
|------|--------|------------------|------------------------|-------|
| `/api/health` (Express) | GET | Always 200 | `{ ok: boolean, service: "api", env: string, uptime_ms: number, db: "ok"\|"error", db_name?: string, db_error?: string }` | Express server health check, basic DB connectivity |
| `/api/health` (Next.js Pages) | GET | 200 if healthy, 503 if unhealthy, 500 on error | `{ ok: boolean }` | Uses `buildBackendReadinessReport()`, returns only `ok` field |
| `/api/readyz` | GET | 200 if healthy, 503 if unhealthy, 500 on error | `{ ok: boolean }` | ✅ **RESOLVED (T1/T2)** - Aligned to canonical response contracts |
| `/api/admin/readyz` | GET | 200 if healthy, 503 if unhealthy, 500 on error | `{ ok: boolean, timestamp?: string }` | ✅ **RESOLVED (T1/T2)** - Aligned to canonical response contracts |
| `/api/analytics/health` | GET | 200 if healthy, 500 on error | `{ ok: boolean, ts: string, db: "ok", activeWorkers: number }` | Custom implementation, checks DB + active workers |
| `/api/health/audit` | GET | 200 if healthy, 401 if missing workspace_id, 500 on error | `{ ok: boolean, lastEventAt?: string, totalEvents: number, stale: boolean }` | Workspace-specific audit health, requires `workspace_id` query param |
| `/api/dashboard/ready` | GET | 200 on success, 500 on error | `{ ok: boolean, items: Clip[] }` | **Not a health endpoint** - returns ready clips for dashboard |

### Contract vs Implementation Notes

**Type Definition** (`packages/shared/src/readiness/backendReadiness.ts`):
```typescript
export type BackendReadinessReport = {
  ok: boolean;
  env: { ok: boolean; missing: string[]; optionalMissing: string[] };
  worker?: WorkerEnvStatus;
  db: { ok: boolean; error?: string; tablesChecked: string[]; missingTables: string[] };
  stripe: { ok: boolean; missingEnv: string[]; priceIdsConfigured: number };
  sentry: { ok: boolean; missingEnv: string[] };
};
```

**Current Implementation Status:**
- `/api/readyz`: ✅ **RESOLVED (T1/T2)** - Now correctly uses canonical response contracts
- `/api/admin/readyz`: ✅ **RESOLVED (T1/T2)** - Now correctly uses canonical response contracts
- `/api/health`: ✅ Correctly uses only `readiness.ok`

**Current Status:**

1. ✅ **RESOLVED (T1/T2)**: Type mismatch fixed - `/api/readyz` and `/api/admin/readyz` now correctly aligned to canonical response contracts
2. **Response Shape Inconsistency**: Different endpoints return different structures (some variation remains, see T9 for standardization work):
   - `/api/health` (Express): Includes `service`, `env`, `uptime_ms`, `db_name`
   - `/api/health` (Next.js): Only `{ ok: boolean }`
   - `/api/analytics/health`: `{ ok, ts, db, activeWorkers }`
   - `/api/health/audit`: `{ ok, lastEventAt, totalEvents, stale }`
3. **Status Code Semantics**: Most use 200/503/500, but `/api/health/audit` uses 401 for missing workspace_id

### Recommendations (with OWNER tags)

1. ✅ **DONE (Person 1)**: Fixed type mismatch in `/api/readyz` and `/api/admin/readyz` (T1/T2 completed)
   - Type mismatch resolved - endpoints now aligned to canonical response contracts
   - Health endpoint consolidation work completed as part of T2

2. ✅ **DONE (Person 1)**: Consolidated health endpoint strategy (T2 completed)
   - Health endpoint consolidation and canonicalization work completed
   - Legacy endpoints deprecated with appropriate headers (see T2-02)

3. **⚠️ MEDIUM (Person 1)**: Standardize response shapes
   - Define a common health response type
   - Ensure all health endpoints return consistent structure (at minimum: `{ ok: boolean }`)

---

## Section B – Engine Internals & Tests

### Key Internals

**Functions/Modules Identified:**

1. **`buildBackendReadinessReport()`** (`packages/shared/src/readiness/backendReadiness.ts`)
   - Checks: env vars, database connectivity, Stripe config, Sentry config, optional worker env
   - Returns: `BackendReadinessReport` type
   - **Status**: ✅ Correctly used by readiness endpoints (T1/T2 resolved)

2. **`getMachineHealthSnapshot()`** (`packages/shared/src/health/engineHealthSnapshot.ts`)
   - Aggregates: queue depths by state/kind, worker activity, FFmpeg/yt-dlp availability, recent errors
   - Returns: `EngineHealthSnapshot` type
   - **Status**: ✅ Well-implemented, comprehensive test coverage (used by readiness endpoints)

3. **Dead-Letter Queue Logic**
   - RPC: `worker_fail` (increments attempts, moves to DLQ after max_attempts)
   - RPC: `worker_claim_next_job` (excludes DLQ jobs)
   - Helper: `requeueDeadLetterJob()` (`apps/worker/src/lib/jobAdmin.ts`)
   - **Status**: ✅ Implemented, tests exist

4. **Worker Claiming & Heartbeat**
   - RPC: `worker_claim_next_job` (claims next eligible job)
   - RPC: `worker_heartbeat` (updates heartbeat_at)
   - Stale job reclamation logic
   - **Status**: ✅ Implemented

### Test Run Summary

| Command | Result | Notes | OWNER |
|---------|--------|-------|-------|
| `pnpm test:core` | ✅ **PASS** | 50 tests passed (4 test files): `healthz`, `engineHealthSnapshot`, `usageTracker`, `videoInput` | Person 1 |
| `pnpm test test/worker/dead-letter-queue.test.ts` | ✅ **PASS** | Test file now included in vitest config (T5 completed) | Person 1 |

**Test Coverage Details:**

- ✅ `test/shared/engineHealthSnapshot.test.ts` - 12 tests (snapshot structure, queue metrics, worker activity, recent errors, health status)
- ✅ `test/shared/usageTracker.posts.test.ts` - 14 tests (plan limits, checkUsage, assertWithinUsage, recordUsage)
- ✅ `test/shared/videoInput.test.ts` - 22 tests (YouTube/TikTok URL parsing, validation, error details)
- ✅ `test/api/healthz.test.ts` - 2 tests (returns 200 with correct shape, lightweight and fast)
- ✅ `test/worker/dead-letter-queue.test.ts` - Now included in vitest config (T5 completed)

**Missing or Incomplete Tests:**

1. ✅ **RESOLVED (T6)**: Integration tests for readiness endpoints - real integration tests added for healthz/readyz/admin readyz endpoints
   - `apps/web/test/api/health.integration.test.ts` - Integration tests using real `buildBackendReadinessReport()`
   - `apps/web/test/api/readyz.integration.test.ts` - Integration tests using real readiness checks
   - `apps/web/test/api/admin.readyz.integration.test.ts` - Integration tests using real readiness checks

2. ✅ **RESOLVED (T5)**: DLQ test configuration - vitest config updated to include `test/worker/**/*.test.ts` in search path

3. **End-to-end readiness flow**: No test that exercises full readiness check with real database

### Recommendations (with OWNER tags)

1. ✅ **DONE (Person 1)**: Fixed DLQ test configuration (T5 completed)
   - Vitest config updated to include `test/worker/**/*.test.ts` in search path

2. ✅ **DONE (Person 1)**: Added integration tests for readiness endpoints (T6 completed)
   - Integration tests created that use real `buildBackendReadinessReport()` (not mocked)
   - Tests include real database connectivity checks
   - Response shapes verified to match type definitions

3. **⚠️ LOW (Person 1)**: Add end-to-end readiness flow test
   - Test full readiness check including worker status, queue health, FFmpeg availability

---

## Section C – Env & Configuration

### Env Key Inventory

**Core Env Schema** (`packages/shared/src/env.ts`):

| Key | Present in Schema? | Present in .env.example? | Used in Code? | Notes |
|-----|-------------------|---------------------------|---------------|-------|
| `NODE_ENV` | ✅ | ❓ | ✅ | Default: "development" |
| `SUPABASE_URL` | ✅ | ❓ | ✅ | Required, validated as URL |
| `SUPABASE_ANON_KEY` | ✅ | ❓ | ✅ | Required, min 20 chars |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❓ | ✅ | Required, min 20 chars |
| `WORKER_POLL_MS` | ✅ | ❓ | ✅ | Optional |
| `WORKER_HEARTBEAT_MS` | ✅ | ❓ | ✅ | Optional |
| `WORKER_RECLAIM_MS` | ✅ | ❓ | ✅ | Optional |
| `WORKER_STALE_SECONDS` | ✅ | ❓ | ✅ | Optional |
| `LOG_SAMPLE_RATE` | ✅ | ❓ | ✅ | Default: "1" |
| `SENTRY_DSN` | ✅ | ❓ | ✅ | Optional, default: "" |
| `DATABASE_URL` | ✅ | ❓ | ✅ | Optional |
| `STRIPE_SECRET_KEY` | ✅ | ❓ | ✅ | Optional |
| `STRIPE_WEBHOOK_SECRET` | ✅ | ❓ | ✅ | Optional |
| `DEEPGRAM_API_KEY` | ✅ | ❓ | ✅ | Optional |
| `OPENAI_API_KEY` | ✅ | ❓ | ✅ | Optional |
| `GOOGLE_CLIENT_ID` | ✅ | ❓ | ✅ | Optional |
| `GOOGLE_CLIENT_SECRET` | ✅ | ❓ | ✅ | Optional |
| `YOUTUBE_OAUTH_REDIRECT_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `TIKTOK_CLIENT_ID` | ✅ | ❓ | ✅ | Optional |
| `TIKTOK_CLIENT_SECRET` | ✅ | ❓ | ✅ | Optional |
| `TIKTOK_OAUTH_REDIRECT_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `TIKTOK_TOKEN_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `TIKTOK_ENCRYPTION_KEY` | ✅ | ❓ | ✅ | Optional, min 1 char |
| `CRON_SECRET` | ✅ | ❓ | ✅ | Optional |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | ✅ | ❓ | ✅ | Optional |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ❓ | ✅ | Optional |
| `NEXT_PUBLIC_TIKTOK_REDIRECT_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `NEXT_PUBLIC_APP_URL` | ✅ | ❓ | ✅ | Optional, validated as URL |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ | ❓ | ✅ | Optional |

**Note**: ✅ `.env.example` file now exists and is in sync with EnvSchema (33 keys). `pnpm check:env:template` passes. File: `.env.example`

### Env Schema Structure

**Top-Level Objects:**
- **Server-side**: All env vars accessible via `getEnv()` from `@cliply/shared/env`
- **Client-side**: Only `NEXT_PUBLIC_*` vars exposed via `publicEnv` from `apps/web/src/lib/env.ts`
- **Web adapter**: `apps/web/src/lib/env.ts` provides `serverEnv` and `publicEnv` accessors

**Validation:**
- ✅ Centralized Zod schema in `packages/shared/src/env.ts`
- ✅ Validates on first access with clear error messages
- ✅ Test mode (NODE_ENV=test) disables caching for dynamic env changes
- ✅ Fallback logic for `NEXT_PUBLIC_*` vars

### Misalignment List

1. ✅ **`.env.example` file created**: File now exists and is in sync with EnvSchema (33 keys). `pnpm check:env:template` passes. File: `.env.example`

2. **Env key usage in code vs schema**: All keys in schema appear to be used in code (no obvious unused keys)

3. **Documentation vs schema**: `ENV.md` references `.env.example` which doesn't exist

### Recommendations (with OWNER tags)

1. ✅ **DONE (Person 1)**: Create `.env.example` file
   - ✅ File created with all env vars from schema (33 keys), organized by category
   - ✅ `pnpm check:env:template` now passes
   - ✅ File: `.env.example`

2. ✅ **DONE (Person 1)**: Run `pnpm check:env:template` to verify sync
   - ✅ Script verified: `scripts/check-env-template-sync.ts`
   - ✅ `.env.example` is in sync with EnvSchema (33 keys match)
   - ✅ Includes `NEXT_PUBLIC_YOUTUBE_REDIRECT_URL`

3. **⚠️ LOW (Person 1)**: Verify CI env vars are documented
   - Check if CI/CD pipeline has env var documentation
   - Ensure all required vars are set in CI environment

---

## Section D – Supabase Schema & RLS

### Table Inventory (High Level)

**Core Domain Tables:**
- ✅ `workspaces` - Workspace management
- ✅ `workspace_members` - Workspace membership
- ✅ `organizations` - Organization management
- ✅ `org_workspaces` - Organization-workspace linking
- ✅ `projects` - Video projects
- ✅ `clips` - Generated clips
- ✅ `schedules` - Publishing schedules
- ✅ `jobs` - Background job queue
- ✅ `job_events` - Job event history
- ✅ `connected_accounts` - TikTok/YouTube OAuth accounts
- ✅ `subscriptions` - Billing subscriptions
- ✅ `products` - Product catalog
- ✅ `clip_products` - Clip-product associations
- ✅ `workspace_usage` - Usage tracking
- ✅ `rate_limits` - Rate limiting
- ✅ `events` - General events
- ✅ `events_audit` - Audit events
- ✅ `idempotency` - Idempotency keys
- ✅ `dmca_reports` - DMCA reports

**Migration Count**: 58 migration files in `supabase/migrations/`

### RLS Posture Summary

| Table | RLS Enabled? | Policies Present? | Notes | Risk Level |
|-------|-------------|-------------------|-------|------------|
| `workspaces` | ✅ | ✅ | Policies: `wp_select`, `wp_mod` | 🟢 Low |
| `workspace_members` | ✅ | ✅ | Policies: `workspace_members_self` | 🟢 Low |
| `organizations` | ✅ | ✅ | Policies: `org_select`, `org_mod` | 🟢 Low |
| `org_workspaces` | ✅ | ✅ | Policies: `orgws_select` | 🟢 Low |
| `projects` | ✅ | ✅ | Policies: `prj_all` | 🟢 Low |
| `clips` | ✅ | ✅ | Policies exist | 🟢 Low |
| `schedules` | ✅ | ✅ | Policies: `sch_all` | 🟢 Low |
| `jobs` | ✅ | ✅ | **Multiple policy iterations** (4 migrations) | 🟡 Medium |
| `job_events` | ✅ | ✅ | Policies exist | 🟢 Low |
| `connected_accounts` | ✅ | ✅ | Policies exist | 🟢 Low |
| `subscriptions` | ✅ | ✅ | Policies exist | 🟢 Low |
| `products` | ✅ | ✅ | Policies: `products_all` | 🟢 Low |
| `clip_products` | ✅ | ✅ | Policies exist | 🟢 Low |
| `workspace_usage` | ✅ | ✅ | Policies exist | 🟢 Low |
| `rate_limits` | ✅ | ✅ | Multiple policies: `rate_limits_service_role_full_access`, `rate_limits_workspace_member_read`, `rl_all` | 🟢 Low |
| `events` | ✅ | ✅ | Policies exist | 🟢 Low |
| `events_audit` | ✅ | ✅ | Policies exist | 🟢 Low |
| `idempotency` | ✅ | ✅ | Policies exist | 🟢 Low |

**Service Role Access:**
- ✅ `supabase/migrations/20250101000007_rls_service_role_full_access.sql` - Service role has full access to all tables with bypass policies

### Red Flags Identified

1. **🚨 Multiple RLS Policy Iterations for Jobs Table**:
   - `20251022001000_rls_jobs_owner_check_text.sql`
   - `20251022002000_rls_jobs_owner_check_strict_text.sql`
   - `20251022003000_rls_jobs_policy_minimal.sql`
   - `20251022004000_rls_jobs_policy_no_cast_error.sql`
   - **Impact**: Suggests ongoing refinement, possible instability
   - **Risk**: Medium - policies may not be fully tested/stable

2. ✅ **Resolved**: `.env.example` file exists and is in sync with EnvSchema (T3/T4 completed)

### Recommendations (with OWNER tags)

1. **⚠️ MEDIUM (Person 2)**: Stabilize RLS policies for jobs table
   - Review all 4 policy iterations
   - Consolidate into a single, correct policy
   - Add RLS tests to verify policies work correctly
   - Document policy rationale

2. **⚠️ LOW (Person 1)**: Verify RLS policies are tested
   - Check if `test/api/jobs.rls.test.ts` covers all policy scenarios
   - Add integration tests for edge cases (cross-workspace access, service role, etc.)

3. **⚠️ LOW (Person 1)**: Document RLS policy strategy
   - Document which tables use which access patterns
   - Document service role usage (when/why it's used)

---

## Section E – Backlog & Owner Map

### Task List

| ID | Area | Description | OWNER | Impact | Difficulty |
|----|------|-------------|-------|--------|------------|
| **T1** | Readiness | ✅ **DONE** - Fix `BackendReadinessReport` type mismatch - `/api/readyz` and `/api/admin/readyz` reference non-existent `checks`, `queue`, `ffmpeg` properties | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |
| **T2** | Readiness | ✅ **DONE** - Consolidate health endpoint implementations - too many endpoints with different contracts | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |
| **T3** | Env | ✅ **DONE** - Create `.env.example` file with all schema keys documented | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |
| **T4** | Env | ✅ **DONE** - Run `pnpm check:env:template` to verify `.env.example` sync with schema | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |
| **T5** | Tests | ✅ **DONE** - Fix DLQ test configuration - test file exists but not in vitest search path | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |
| **T6** | Tests | ✅ **DONE** - Add integration tests for readiness endpoints (use real `buildBackendReadinessReport`, not mocks) | **Person 1** | ✅ **COMPLETE** | ✅ **DONE** |

| **T7** | RLS | Stabilize RLS policies for jobs table - consolidate 4 policy iterations into one | **Person 2** | ⚠️ **MEDIUM** - Stability concern | **M** (1-2 days) |
| **T8** | RLS | Add RLS integration tests for edge cases (cross-workspace, service role) | **Person 1** | ⚠️ **LOW** - Security verification | **M** (1 day) |
| **T9** | Readiness | Standardize health endpoint response shapes - define common health response type | **Person 1** | ⚠️ **LOW** - Consistency | **S** (2-3 hours) |
| **T10** | Documentation | Document RLS policy strategy and service role usage | **Person 1** | ⚠️ **LOW** - Knowledge sharing | **S** (1-2 hours) |

### Priority Summary

**✅ COMPLETED (Critical Blockers Resolved):**
- T1: Fix BackendReadinessReport type mismatch ✅ **DONE**
- T2: Consolidate health endpoints ✅ **DONE**
- T3: Create `.env.example` file ✅ **DONE** - File created, 33 keys, `check:env:template` passes
- T4: Verify env template sync ✅ **DONE** - `pnpm check:env:template` now green
- T5: Fix DLQ test config ✅ **DONE**
- T6: Add readiness integration tests ✅ **DONE**

**⚠️ MEDIUM (Important but Not Blocking):**
- T7: Stabilize RLS policies

**⚠️ LOW (Nice to Have):**
- T8: RLS edge case tests
- T9: Standardize response shapes
- T10: Document RLS strategy

**Note on Completed Items:**
- **T1 & T2 (Readiness Endpoints)**: ✅ Completed. Type mismatch fixed, endpoints aligned to canonical response contracts. Health endpoint consolidation completed with deprecation headers for legacy endpoints.
- **T3 & T4 (Env Template Sync)**: ✅ Completed. `.env.example` file created with 33 keys matching EnvSchema. `pnpm check:env:template` passes. File: `.env.example`
- **T5 & T6 (Test Configuration)**: ✅ Completed. DLQ test configuration fixed, integration tests added for readiness endpoints.

---

## Appendix: Existing Reports Summary

### `REPORTS/backend_readiness_audit_integrate_engine_surface_v1.md`

**Key Findings from Previous Audit (still relevant):**

1. **✅ Resolved**: Core test coverage is solid (50 tests passing)
2. **✅ Resolved**: BackendReadinessReport type mismatch fixed (T1/T2 completed) - endpoints now aligned to canonical response contracts
3. **⚠️ Still Relevant**: RLS policy instability (multiple iterations) - see T7 for stabilization work
4. **✅ Resolved**: Env schema is centralized and type-safe
5. **⚠️ Still Relevant**: Need to verify all routes use `withAuthContext` & `withPlanGate`

**Status**: Previous audit identified the same critical type mismatch issue. ✅ **RESOLVED** - T1 and T2 have been completed. See task table (Section E) for current status of all tasks.

---

**End of Report**
