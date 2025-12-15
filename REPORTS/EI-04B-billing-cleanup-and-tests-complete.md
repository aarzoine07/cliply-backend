# ✅ EI-04B: Clean Shared Billing Duplication & Add Posts Usage Tests — COMPLETE

## Summary

Successfully cleaned up the shared billing folder duplication, removed the legacy billing directory, and added comprehensive tests for the new `posts` usage metric. All engine-side tests pass and the worker build succeeds.

## Changes Completed

### 1. Cleaned Up Shared Package Structure

**Problem:** The `packages/shared` directory had duplicate billing folders:
- Legacy: `packages/shared/billing/` (outdated)
- Canonical: `packages/shared/src/billing/` (current)

This caused TypeScript build conflicts where both locations were being compiled.

**Solution:**
- ✅ **Removed** `packages/shared/billing/` legacy directory
- ✅ **Updated** `packages/shared/tsconfig.json` to exclude `billing` from compilation
- ✅ **Fixed** import paths in:
  - `packages/shared/src/index.ts` (changed `../billing/*` → `./billing/*`)
  - `packages/shared/src/auth/context.ts` (changed `../../billing/*` → `../billing/*`)
  - `packages/shared/src/readiness/backendReadiness.ts` (same fix)
- ✅ **Fixed** type assertion in `apps/worker/src/jobs/syncSubscriptions.ts` for `PlanName`

**Result:** All billing code now flows through the canonical `src/billing` → `dist/src/billing` path.

### 2. Created Comprehensive Posts Usage Tests

**File:** `test/shared/usageTracker.posts.test.ts` (337 lines)

**Test Coverage (14 tests, all passing):**

#### Plan Limits (3 tests)
- ✅ Basic plan has `posts_per_month: 300`
- ✅ Pro plan has `posts_per_month: 900`
- ✅ Premium plan has `posts_per_month: 1500`

#### `checkUsage` with posts (4 tests)
- ✅ Allows posting when well below limit (5/300 used)
- ✅ Blocks posting when at limit (300/300 used)
- ✅ Allows posting at boundary (899/900, adding 1)
- ✅ Allows large batches if within limit (100/1500, adding 50)

#### `assertWithinUsage` with posts (3 tests)
- ✅ Does not throw when within limit
- ✅ Throws `UsageLimitExceededError` when limit exceeded
- ✅ Error has correct properties (`metric`, `used`, `limit`, `status`)

#### `recordUsage` with posts (3 tests)
- ✅ Calls `increment_workspace_usage` RPC with `posts_count` metric
- ✅ Maps `'posts'` metric to `'posts_count'` column
- ✅ Uses correct period start date format (`YYYY-MM-01`)

#### Consistency (1 test)
- ✅ Posts behaves like other count-based metrics (clips, projects)

### 3. Test Strategy

**Mocking Approach:**
- Mocked `@supabase/supabase-js` module to avoid real DB calls
- Pure in-memory testing for fast, reliable execution
- Verified logic flow without hitting external services

**Key Assertions:**
- Plan limits are correctly defined in `PLAN_MATRIX`
- `checkUsage` correctly evaluates against plan limits
- `assertWithinUsage` throws typed errors with proper status codes
- `recordUsage` calls the correct RPC with the correct column name

## Test Results

### New Posts Usage Tests
✅ **14/14 tests passing**

```bash
pnpm test test/shared/usageTracker.posts.test.ts --run
# Test Files  1 passed (1)
# Tests  14 passed (14)
# Duration  1.99s
```

### Regression Tests (All Passing)

✅ **postingGuard:** 30/30 tests passing
```bash
pnpm test test/engine/postingGuard.test.ts --run
```

✅ **clipCount:** 30/30 tests passing
```bash
pnpm test test/engine/clipCount.test.ts --run
```

✅ **clipOverlap:** 26/26 tests passing
```bash
pnpm test test/engine/clipOverlap.test.ts --run
```

### Build Status

✅ **Shared package:** Builds successfully
✅ **Worker package:** Builds successfully
⚠️ **Web package:** Pre-existing error unrelated to EI-04 changes
   - Error: `Cannot find module '@cliply/shared/types/billing'`
   - This was present before our changes
   - Does not affect engine internals work

## Files Modified

### `packages/shared/tsconfig.json`
- Removed `billing/**/*.ts` from `include` array
- Added `billing` to `exclude` array

### `packages/shared/src/index.ts`
- Changed billing exports from `../billing/*` to `./billing/*`

### `packages/shared/src/auth/context.ts`
- Changed import from `../../billing/planResolution.js` to `../billing/planResolution.js`
- Added type assertion for `PlanName`

### `packages/shared/src/readiness/backendReadiness.ts`
- Changed import from `../../billing/stripePlanMap` to `../billing/stripePlanMap`

### `apps/worker/src/jobs/syncSubscriptions.ts`
- Added type assertion for `plan as PlanName`

### Files Deleted
- **`packages/shared/billing/`** (entire directory removed)

### Files Created
- **`test/shared/usageTracker.posts.test.ts`** (comprehensive test suite)

## Integration with EI-04 (ME-I-04)

This prompt (EI-04B) completes the EI-04 work by:

1. **Resolving build conflicts** caused by duplicate billing folders
2. **Adding comprehensive tests** to validate the posts usage implementation
3. **Ensuring all regression tests pass** (postingGuard, clipCount, clipOverlap)

Combined with EI-04, the full implementation now includes:

- ✅ **planMatrix** with `posts_per_month` limits
- ✅ **usageTracker** supporting `'posts'` metric
- ✅ **Migration** adding `posts_count` column and RPC support
- ✅ **Publish pipelines** calling `assertWithinUsage` and `recordUsage`
- ✅ **Comprehensive tests** validating all posts usage behavior
- ✅ **Clean package structure** with no build conflicts

## Behavioral Examples

### Example 1: Basic Plan Posting

**Scenario:** Workspace on `basic` plan (300 posts/month limit)
- Current usage: 250 posts
- Attempting to post: 1 clip

**Flow:**
1. `publish-tiktok.ts` calls `assertWithinUsage('workspace-123', 'posts', 1)`
2. `usageTracker` fetches workspace plan → `'basic'`
3. Looks up `PLAN_MATRIX.basic.limits.posts_per_month` → `300`
4. Fetches current usage → `250`
5. Checks: `250 + 1 <= 300` → ✅ Allowed
6. After successful upload, calls `recordUsage({ metric: 'posts', amount: 1 })`
7. RPC increments `workspace_usage.posts_count` from 250 → 251

### Example 2: Pro Plan at Limit

**Scenario:** Workspace on `pro` plan (900 posts/month limit)
- Current usage: 900 posts
- Attempting to post: 1 clip

**Flow:**
1. `publish-youtube.ts` calls `assertWithinUsage('workspace-456', 'posts', 1)`
2. `usageTracker` fetches workspace plan → `'pro'`
3. Looks up `PLAN_MATRIX.pro.limits.posts_per_month` → `900`
4. Fetches current usage → `900`
5. Checks: `900 + 1 > 900` → ❌ **Limit exceeded**
6. Throws `UsageLimitExceededError`:
   ```typescript
   {
     metric: 'posts',
     used: 900,
     limit: 900,
     status: 429,
     message: 'Usage limit exceeded for posts: 900/900'
   }
   ```
7. Pipeline logs `posting_usage_limit_exceeded` and re-throws
8. Surface code (David's track) can catch this and return 429 Too Many Requests

## Next Steps (Beyond EI-04B)

**Potential Future Work:**
1. **Fix web package build error** (separate from engine internals)
2. **Add publish pipeline integration tests** (complex due to mocking requirements)
3. **ME-I-05:** Align postingGuard with planMatrix limits (currently uses separate defaults)
4. **ME-I-06:** Add posts analytics and reporting
5. **ME-I-07:** Implement workspace-level posting quotas (currently per-account only)

## Acceptance Criteria

✅ **`packages/shared/billing/` removed**
- Legacy folder deleted
- No references remain in imports

✅ **`tsconfig.json` updated**
- Only compiles from `src/`
- Excludes legacy `billing/` folder

✅ **New tests exist and pass**
- `test/shared/usageTracker.posts.test.ts`: 14/14 ✅
- Validates `posts` metric behavior
- Confirms plan limits
- Verifies RPC calls

✅ **Regression tests pass**
- `postingGuard`: 30/30 ✅
- `clipCount`: 30/30 ✅
- `clipOverlap`: 26/26 ✅

✅ **Build succeeds**
- Shared package: ✅
- Worker package: ✅
- No TypeScript conflicts from billing duplication

All acceptance criteria met! 🎉

