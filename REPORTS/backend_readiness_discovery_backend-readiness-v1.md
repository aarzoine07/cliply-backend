# Backend Readiness Discovery Report

**Run #1 – 2025-12-10 20:39 UTC**  
**Git Branch:** `backend-readiness-v1`  
**Git Commit:** `2778e6d63937faf74f4c002c406bfbf5334b07f7`  
**Node Version:** v22.17.0  
**pnpm Version:** 10.24.0

---

## High-Level Summary

### Overall Readiness Posture: **🟡 YELLOW** (Functional but with critical blockers)

**Key Findings:**

- ✅ **Strong Foundation**: Centralized env schema, comprehensive test coverage (50+ tests passing), engine health snapshot implemented, DLQ logic in place
- 🚨 **Critical Blocker**: Type mismatch in readiness endpoints (`/api/readyz`, `/api/admin/readyz`) will cause runtime crashes in production
- ⚠️ **Multiple Health Endpoints**: 6+ different health/readiness endpoints with inconsistent implementations and response shapes
- ✅ **Engine Internals**: Solid implementation of jobs, worker, DLQ, health snapshot with good test coverage
- ✅ **Supabase Schema**: 58 migrations, RLS enabled on core tables, service role policies in place
- ⚠️ **RLS Policy Instability**: Multiple iterations of RLS policies for jobs table suggest ongoing refinement
- ✅ **Env Schema**: Well-structured, type-safe, with validation and documentation

**Immediate "Must Fix Soon" Items:**

1. **🚨 CRITICAL (Person 1)**: Fix `BackendReadinessReport` type mismatch - `/api/readyz` and `/api/admin/readyz` will crash at runtime
2. **⚠️ HIGH (Person 1)**: Consolidate health endpoint implementations - too many endpoints with different contracts
3. **⚠️ MEDIUM (Person 1)**: Verify `.env.example` exists and is in sync with env schema
4. **⚠️ MEDIUM (Person 2)**: Stabilize RLS policies - multiple iterations suggest instability

---

## Section A – Readiness & Health Model

### Endpoint Inventory

| Path | Method | Status Semantics | Response Schema Summary | Notes |
|------|--------|------------------|------------------------|-------|
| `/api/health` (Express) | GET | Always 200 | `{ ok: boolean, service: "api", env: string, uptime_ms: number, db: "ok"\|"error", db_name?: string, db_error?: string }` | Express server health check, basic DB connectivity |
| `/api/health` (Next.js Pages) | GET | 200 if healthy, 503 if unhealthy, 500 on error | `{ ok: boolean }` | Uses `buildBackendReadinessReport()`, returns only `ok` field |
| `/api/readyz` | GET | 200 if healthy, 503 if unhealthy, 500 on error | **🚨 BROKEN**: Tries to return `{ ok, checks, queue, ffmpeg }` but these fields don't exist in `BackendReadinessReport` | **Will crash at runtime** |
| `/api/admin/readyz` | GET | 200 if healthy, 503 if unhealthy, 500 on error | **🚨 BROKEN**: Same as `/api/readyz` + `timestamp` field | **Will crash at runtime** |
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

**What Endpoints Try to Access:**
- `/api/readyz` (line 19-21, 27-32): Tries to access `readiness.checks`, `readiness.queue`, `readiness.ffmpeg` ❌
- `/api/admin/readyz` (line 23-27, 33-39): Same issue ❌
- `/api/health` (line 15-20): Correctly uses only `readiness.ok` ✅

**Inconsistencies Identified:**

1. **Type Mismatch (CRITICAL)**: `/api/readyz` and `/api/admin/readyz` reference properties that don't exist in `BackendReadinessReport`
2. **Response Shape Inconsistency**: Different endpoints return different structures:
   - `/api/health` (Express): Includes `service`, `env`, `uptime_ms`, `db_name`
   - `/api/health` (Next.js): Only `{ ok: boolean }`
   - `/api/analytics/health`: `{ ok, ts, db, activeWorkers }`
   - `/api/health/audit`: `{ ok, lastEventAt, totalEvents, stale }`
3. **Status Code Semantics**: Most use 200/503/500, but `/api/health/audit` uses 401 for missing workspace_id

### Recommendations (with OWNER tags)

1. **🚨 CRITICAL (Person 1)**: Fix type mismatch in `/api/readyz` and `/api/admin/readyz`
   - Option A: Extend `BackendReadinessReport` to include `checks`, `queue`, `ffmpeg` and implement them
   - Option B: Remove references to non-existent fields and use existing structure
   - **Recommendation**: Option A - extend the type to match endpoint expectations, integrate with `engineHealthSnapshot`

2. **⚠️ HIGH (Person 1)**: Consolidate health endpoint strategy
   - Decide on a single "public" health endpoint (likely `/api/health`)
   - Decide on a single "admin/detailed" readiness endpoint (likely `/api/admin/readyz`)
   - Deprecate or remove redundant endpoints (`/api/analytics/health`, Express `/api/health`)

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
   - **Issue**: Missing `checks`, `queue`, `ffmpeg` properties that endpoints expect

2. **`getMachineHealthSnapshot()`** (`packages/shared/src/health/engineHealthSnapshot.ts`)
   - Aggregates: queue depths by state/kind, worker activity, FFmpeg/yt-dlp availability, recent errors
   - Returns: `EngineHealthSnapshot` type
   - **Status**: ✅ Well-implemented, comprehensive test coverage

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
| `pnpm test test/worker/dead-letter-queue.test.ts` | ❌ **FAIL** | Test file exists but not found by vitest config (config looks in `apps/web/test/**/*.test.ts`, but file is in `test/worker/`) | Person 1 |

**Test Coverage Details:**

- ✅ `test/shared/engineHealthSnapshot.test.ts` - 12 tests (snapshot structure, queue metrics, worker activity, recent errors, health status)
- ✅ `test/shared/usageTracker.posts.test.ts` - 14 tests (plan limits, checkUsage, assertWithinUsage, recordUsage)
- ✅ `test/shared/videoInput.test.ts` - 22 tests (YouTube/TikTok URL parsing, validation, error details)
- ✅ `test/api/healthz.test.ts` - 2 tests (returns 200 with correct shape, lightweight and fast)
- ✅ `test/worker/dead-letter-queue.test.ts` - Exists but not runnable with current test config

**Missing or Incomplete Tests:**

1. **Integration tests for readiness endpoints**: Tests exist but all use mocks - no real integration tests
   - `apps/web/test/api/health.test.ts` - 5 tests (all mocked)
   - `apps/web/test/api/readyz.test.ts` - 8 tests (all mocked)
   - `apps/web/test/api/admin.readyz.test.ts` - 8 tests (all mocked)

2. **DLQ test configuration**: Test file exists but vitest config doesn't include it in search path

3. **End-to-end readiness flow**: No test that exercises full readiness check with real database

### Recommendations (with OWNER tags)

1. **⚠️ MEDIUM (Person 1)**: Fix DLQ test configuration
   - Update vitest config to include `test/worker/**/*.test.ts` in search path
   - Or move test to `apps/web/test/worker/` to match current config

2. **⚠️ MEDIUM (Person 1)**: Add integration tests for readiness endpoints
   - Create tests that use real `buildBackendReadinessReport()` (not mocked)
   - Test with real database connectivity checks
   - Verify response shapes match type definitions

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

**Note**: `.env.example` file was not found in the repository. According to `ENV.md`, it should exist and be the template for local setup.

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

1. **Missing `.env.example` file**: Documented in `ENV.md` but not found in repository
   - **Impact**: Developers may not know which env vars to set
   - **Recommendation**: Create `.env.example` with all schema keys documented

2. **Env key usage in code vs schema**: All keys in schema appear to be used in code (no obvious unused keys)

3. **Documentation vs schema**: `ENV.md` references `.env.example` which doesn't exist

### Recommendations (with OWNER tags)

1. **⚠️ HIGH (Person 1)**: Create `.env.example` file
   - Include all env vars from schema with helpful comments
   - Organize by category (Core, Supabase, Worker, External Services, etc.)
   - Mark required vs optional clearly

2. **⚠️ MEDIUM (Person 1)**: Run `pnpm check:env:template` to verify sync
   - Script exists: `scripts/check-env-template-sync.ts`
   - Ensures `.env.example` stays in sync with schema

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

2. **⚠️ Missing `.env.example`**: Cannot verify if all required Supabase env vars are documented

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
| **T1** | Readiness | Fix `BackendReadinessReport` type mismatch - `/api/readyz` and `/api/admin/readyz` reference non-existent `checks`, `queue`, `ffmpeg` properties | **Person 1** | 🚨 **CRITICAL** - Will crash in production | **S** (2-4 hours) |
| **T2** | Readiness | Consolidate health endpoint implementations - too many endpoints with different contracts | **Person 1** | ⚠️ **HIGH** - Confusion, maintenance burden | **M** (1 day) |
| **T3** | Env | Create `.env.example` file with all schema keys documented | **Person 1** | ⚠️ **HIGH** - Developer onboarding blocker | **S** (1-2 hours) |
| **T4** | Env | Run `pnpm check:env:template` to verify `.env.example` sync with schema | **Person 1** | ⚠️ **MEDIUM** - Prevents drift | **S** (30 min) |
| **T5** | Tests | Fix DLQ test configuration - test file exists but not in vitest search path | **Person 1** | ⚠️ **MEDIUM** - Test coverage gap | **S** (30 min) |
| **T6** | Tests | Add integration tests for readiness endpoints (use real `buildBackendReadinessReport`, not mocks) | **Person 1** | ⚠️ **MEDIUM** - Test quality | **M** (4-6 hours) |
| **T7** | RLS | Stabilize RLS policies for jobs table - consolidate 4 policy iterations into one | **Person 2** | ⚠️ **MEDIUM** - Stability concern | **M** (1-2 days) |
| **T8** | RLS | Add RLS integration tests for edge cases (cross-workspace, service role) | **Person 1** | ⚠️ **LOW** - Security verification | **M** (1 day) |
| **T9** | Readiness | Standardize health endpoint response shapes - define common health response type | **Person 1** | ⚠️ **LOW** - Consistency | **S** (2-3 hours) |
| **T10** | Documentation | Document RLS policy strategy and service role usage | **Person 1** | ⚠️ **LOW** - Knowledge sharing | **S** (1-2 hours) |

### Priority Summary

**🚨 CRITICAL (Must Fix Before Production):**
- T1: Fix BackendReadinessReport type mismatch

**⚠️ HIGH (Should Fix Soon):**
- T2: Consolidate health endpoints
- T3: Create `.env.example` file

**⚠️ MEDIUM (Important but Not Blocking):**
- T4: Verify env template sync
- T5: Fix DLQ test config
- T6: Add readiness integration tests
- T7: Stabilize RLS policies

**⚠️ LOW (Nice to Have):**
- T8: RLS edge case tests
- T9: Standardize response shapes
- T10: Document RLS strategy

---

## Appendix: Existing Reports Summary

### `REPORTS/backend_readiness_audit_integrate_engine_surface_v1.md`

**Key Findings from Previous Audit (still relevant):**

1. **✅ Resolved**: Core test coverage is solid (50 tests passing)
2. **🚨 Still Critical**: BackendReadinessReport type mismatch (Task 1.1) - **NOT RESOLVED**
3. **⚠️ Still Relevant**: RLS policy instability (multiple iterations)
4. **✅ Resolved**: Env schema is centralized and type-safe
5. **⚠️ Still Relevant**: Need to verify all routes use `withAuthContext` & `withPlanGate`

**Status**: Previous audit identified the same critical type mismatch issue. It remains unresolved in `backend-readiness-v1` branch.

---

**End of Report**

