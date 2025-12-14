# T6-00: Readiness Endpoint Integration Tests — Implementation Plan

**Status:** Plan Ready for Implementation  
**Date:** 2025-01-27  
**Branch:** `backend-readiness-v1`  
**Task:** T6 (Implementation - No Discovery Report Needed)

---

## Next Task Decision

### Task ID: **T6**

### Why This Task is Next

After T5 (DLQ test configuration fix), T6 is the next incomplete task in the backend readiness sequence. T6 addresses a critical gap in test quality: all current readiness endpoint tests use mocks instead of real implementations, which means:

1. **No real database connectivity verification** - Tests don't verify that `buildBackendReadinessReport()` can actually connect to Supabase
2. **No real environment variable validation** - Tests don't verify that env checks work with actual env vars
3. **No real queue health snapshot integration** - Tests don't verify that queue metrics are correctly fetched from the database
4. **Type safety gaps** - Tests mock fields that may not exist in the actual type (as noted in T1)

### Task Details from Discovery Report

- **Owner:** Person 1
- **Impact:** ⚠️ **MEDIUM** - Test quality improvement
- **Difficulty:** **M** (4-6 hours)
- **Area:** Tests
- **Description:** Add integration tests for readiness endpoints (use real `buildBackendReadinessReport`, not mocks)

### Risk Assessment

- **Risk Level:** 🟢 **LOW**
  - Additive changes only (new test files, no code modifications)
  - Existing mocked tests remain as unit tests
  - Integration tests can be skipped if Supabase is not configured
  - No breaking changes to application code

### Estimated Effort

**4-6 hours** (Medium complexity)
- 1-2 hours: Set up integration test infrastructure
- 2-3 hours: Write integration tests for `/api/health`, `/api/readyz`, `/api/admin/readyz`
- 1 hour: Verify tests pass in CI and local environments
- 30 min: Documentation and cleanup

---

## Implementation Plan

### Scope

Add integration tests that use the **real** `buildBackendReadinessReport()` function with:
- Real Supabase database connections (using `supabaseTest` from `packages/shared/test/setup.ts`)
- Real environment variable checks (using actual `process.env`)
- Real queue health snapshot integration (fetching from actual database)
- Real FFmpeg availability checks (if available in test environment)

**Files to Create/Modify:**

1. **New file:** `apps/web/test/api/health.integration.test.ts`
   - Integration tests for `/api/health` endpoint
   - Uses real `buildBackendReadinessReport()` (no mocks)

2. **New file:** `apps/web/test/api/readyz.integration.test.ts`
   - Integration tests for `/api/readyz` endpoint
   - Uses real `buildBackendReadinessReport()` with `includeDetailedHealth: true`

3. **New file:** `apps/web/test/api/admin.readyz.integration.test.ts`
   - Integration tests for `/api/admin/readyz` endpoint
   - Uses real `buildBackendReadinessReport()` with `includeDetailedHealth: true`

4. **No modifications** to existing mocked test files:
   - `apps/web/test/api/health.test.ts` (keep as unit tests)
   - `apps/web/test/api/readyz.test.ts` (keep as unit tests)
   - `apps/web/test/api/admin.readyz.test.ts` (keep as unit tests)

### Implementation Steps

#### Step 1: Create Integration Test Infrastructure

**File:** `apps/web/test/api/health.integration.test.ts`

```typescript
// @ts-nocheck
import { describe, expect, it, beforeAll } from "vitest";
import { isSupabaseTestConfigured, supabaseTest } from "@cliply/shared/test/setup";
import healthRoute from "../../src/pages/api/health";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof healthRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe("GET /api/health (Integration)", () => {
  beforeAll(() => {
    // Skip tests if Supabase is not configured
    if (!isSupabaseTestConfigured()) {
      console.warn("⚠️  Skipping integration tests: Supabase not configured");
    }
  });

  it.skipIf(!isSupabaseTestConfigured())(
    "returns 200 with { ok: true } when system is healthy (real DB)",
    async () => {
      const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  );

  // Add more integration test cases...
});
```

**Key Points:**
- Use `isSupabaseTestConfigured()` to conditionally skip tests if Supabase is not available
- Use `supabaseTest` client for real database operations
- **Do NOT mock** `buildBackendReadinessReport` - let it run with real implementation
- Use `.skipIf()` to conditionally skip tests based on Supabase availability

#### Step 2: Create `/api/readyz` Integration Tests

**File:** `apps/web/test/api/readyz.integration.test.ts`

**Test Cases to Implement:**

1. **Happy path:** System is healthy, returns 200 with full readiness object
   - Verify `ok: true`
   - Verify `checks.db.ok: true` (real DB check)
   - Verify `checks.worker.ok` (if worker env available)
   - Verify `queue.length` is a number (real queue metrics)
   - Verify `queue.oldestJobAge` is a number or null
   - Verify `ffmpeg.ok` is a boolean (real FFmpeg check)

2. **Database connectivity failure:** Mock DB failure scenario (if possible) or test with invalid credentials
   - Verify returns 503
   - Verify `ok: false`
   - Verify `checks.db.ok: false` with error message

3. **Queue health metrics:** Verify queue metrics are fetched from real database
   - Create test jobs in database (if possible)
   - Verify `queue.length` reflects actual queue state
   - Verify `queue.oldestJobAge` reflects actual oldest job age

4. **FFmpeg availability:** Verify FFmpeg check works (if FFmpeg is available in test environment)
   - If FFmpeg is available: verify `ffmpeg.ok: true`
   - If FFmpeg is not available: verify `ffmpeg.ok: false` with message

#### Step 3: Create `/api/admin/readyz` Integration Tests

**File:** `apps/web/test/api/admin.readyz.integration.test.ts`

**Test Cases to Implement:**

1. **Happy path:** Same as `/api/readyz` but verify `timestamp` field is present
   - Verify `timestamp` is a valid ISO 8601 string
   - Verify `timestamp` is recent (within last 5 seconds)

2. **All other test cases from `/api/readyz`** but with timestamp verification

#### Step 4: Handle Test Environment Setup

**Considerations:**

1. **Supabase Configuration:**
   - Tests should use `supabaseTest` from `packages/shared/test/setup.ts`
   - Tests should skip if `isSupabaseTestConfigured()` returns false
   - Tests should work in CI (where Supabase is configured) and gracefully skip locally if not configured

2. **Environment Variables:**
   - Tests should use real `process.env` values
   - Tests should verify that env checks work correctly
   - Tests should handle missing optional env vars gracefully

3. **FFmpeg Availability:**
   - Tests should check if FFmpeg is available in test environment
   - Tests should handle both cases (FFmpeg available vs. not available)

4. **Queue State:**
   - Tests should work with empty queue (default state)
   - Tests can optionally seed test jobs to verify queue metrics (if needed)

#### Step 5: Verify Tests Pass

**Commands to Run:**

```bash
# 1. Run integration tests (should pass if Supabase is configured)
pnpm test apps/web/test/api/health.integration.test.ts
pnpm test apps/web/test/api/readyz.integration.test.ts
pnpm test apps/web/test/api/admin.readyz.integration.test.ts

# 2. Run all readiness tests (mocked + integration)
pnpm test apps/web/test/api/health.test.ts
pnpm test apps/web/test/api/readyz.test.ts
pnpm test apps/web/test/api/admin.readyz.test.ts

# 3. Run full test suite to ensure no regressions
pnpm test:core

# 4. Verify build succeeds
pnpm build
```

### Acceptance Criteria

#### Must Have (Required for Completion)

- [ ] **Integration test files created:**
  - `apps/web/test/api/health.integration.test.ts` exists
  - `apps/web/test/api/readyz.integration.test.ts` exists
  - `apps/web/test/api/admin.readyz.integration.test.ts` exists

- [ ] **Tests use real `buildBackendReadinessReport()`:**
  - No mocks for `@cliply/shared/readiness/backendReadiness`
  - Tests call real function with real Supabase client
  - Tests verify real database connectivity

- [ ] **Tests are conditionally skipped:**
  - Tests skip if `isSupabaseTestConfigured()` returns false
  - Tests pass if Supabase is configured (CI environment)
  - Tests gracefully skip locally if Supabase is not configured

- [ ] **Core test cases implemented:**
  - Happy path: System healthy, returns 200 with correct shape
  - Database connectivity: Verifies real DB connection works
  - Queue metrics: Verifies queue metrics are fetched from real DB
  - Response shape: Verifies response matches `BackendReadinessReport` type

- [ ] **All tests pass:**
  - Integration tests pass in CI (where Supabase is configured)
  - Existing mocked tests still pass (no regressions)
  - `pnpm test:core` passes
  - `pnpm build` succeeds

#### Nice to Have (Optional Enhancements)

- [ ] **Advanced test cases:**
  - Test with seeded jobs in database to verify queue metrics
  - Test with missing optional env vars to verify graceful handling
  - Test FFmpeg availability detection (if FFmpeg is available in test environment)

- [ ] **Performance tests:**
  - Verify readiness checks complete within reasonable time (< 5 seconds)
  - Verify database queries are efficient

### Files Likely to Touch

**New Files (3):**
1. `apps/web/test/api/health.integration.test.ts`
2. `apps/web/test/api/readyz.integration.test.ts`
3. `apps/web/test/api/admin.readyz.integration.test.ts`

**Existing Files (No Changes):**
- `apps/web/test/api/health.test.ts` (keep as-is, unit tests)
- `apps/web/test/api/readyz.test.ts` (keep as-is, unit tests)
- `apps/web/test/api/admin.readyz.test.ts` (keep as-is, unit tests)
- `packages/shared/test/setup.ts` (use existing, no changes)
- `packages/shared/src/readiness/backendReadiness.ts` (use existing, no changes)

### Rollback Strategy

If issues arise:

1. **Revert PR immediately** - Integration tests are additive, so reverting is safe
2. **Verify existing tests still pass** - Ensure mocked tests are unaffected
3. **Document issue** - Note what failed (Supabase connectivity, env vars, etc.)
4. **Re-assess approach** - Consider if integration tests need different setup or if they should be skipped in certain environments

### Stop Condition

**Stop after:**
- ✅ All three integration test files created
- ✅ Core test cases implemented (happy path, DB connectivity, queue metrics, response shape)
- ✅ Tests pass in CI (where Supabase is configured)
- ✅ Tests gracefully skip locally if Supabase is not configured
- ✅ Existing mocked tests still pass (no regressions)
- ✅ `pnpm test:core` passes
- ✅ `pnpm build` succeeds

**Do NOT:**
- ❌ Modify existing mocked test files
- ❌ Modify `buildBackendReadinessReport()` implementation
- ❌ Modify endpoint handlers
- ❌ Add new dependencies
- ❌ Change test directory structure
- ❌ Implement advanced test cases if core cases are not working

---

## Implementation Notes

### Test Pattern Reference

**Existing Integration Test Example:**
- `test/api/healthz.test.ts` - Real integration test (no mocks)
- `apps/worker/test/worker.lifecycle.test.ts` - Uses real Supabase client

**Test Setup Pattern:**
```typescript
import { isSupabaseTestConfigured, supabaseTest } from "@cliply/shared/test/setup";

describe("Integration Tests", () => {
  it.skipIf(!isSupabaseTestConfigured())("test case", async () => {
    // Use supabaseTest for real DB operations
    // Call real buildBackendReadinessReport() without mocks
  });
});
```

### Handling Missing Supabase in Local Development

**Strategy:**
- Use `isSupabaseTestConfigured()` to check if Supabase is available
- Use `.skipIf()` to conditionally skip tests
- Tests will run in CI (where Supabase is configured) but skip locally if not configured
- This is acceptable - integration tests are primarily for CI verification

### Verifying Real Database Connectivity

**Approach:**
- Call `buildBackendReadinessReport()` with real Supabase client
- Verify that `db.ok: true` when database is accessible
- Verify that `db.tablesChecked` includes expected tables (workspaces, jobs, schedules, subscriptions)
- Verify that `db.missingTables` is empty when all tables exist

### Verifying Queue Metrics

**Approach:**
- Call `buildBackendReadinessReport()` with `includeDetailedHealth: true` and real Supabase client
- Verify that `queue.length` is a number (may be 0 if queue is empty)
- Verify that `queue.oldestJobAge` is a number or null
- Optionally seed test jobs to verify metrics reflect actual queue state

---

**End of Plan**

