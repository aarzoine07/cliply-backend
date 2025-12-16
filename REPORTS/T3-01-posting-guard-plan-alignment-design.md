# T3-01 — Posting Guard Plan Alignment & Cron Design

**Status:** Design (Documentation Only)  
**Created:** 2025-01-XX  
**Purpose:** Detailed design for aligning posting guard limits with plan matrix and verifying cron deployment

---

## 1. Current State — Posting Guard

### 1.1 Files and Responsibilities

The posting guard implementation lives in `packages/shared/src/engine/postingGuard.ts`. This module provides anti-spam protection for TikTok and YouTube publishing by:

- **Enforcing daily posting limits** (per account, per platform)
- **Enforcing minimum intervals** between consecutive posts
- **Tracking posting history** to determine if a new post would violate limits

**Key Functions:**

1. **`getDefaultPostingLimitsForPlan(planName?: string): PostingLimits`** (lines 101-112)
   - Currently uses a hardcoded `switch` statement to return limits based on plan tier
   - Returns `PostingLimits` with `maxPerDay` and `minIntervalMs`
   - Has a TODO comment on line 102: `// TODO (ME-I-04): Align with planMatrix limits and add to plan features`
   - Current hardcoded limits:
     - `premium`: 50/day, 1 minute interval
     - `pro`: 30/day, 2 minute interval
     - `basic` (default): 10/day, 5 minute interval

2. **`canPostClip(options): { allowed: boolean; reason?: string; remainingMs?: number }`** (lines 134-170)
   - Pure function that checks if posting is allowed given history and limits
   - Filters history to last 24 hours
   - Checks daily limit (count of posts in last 24h)
   - Checks minimum interval since last post
   - Returns advisory result (doesn't throw)

3. **`enforcePostLimits(options): void`** (lines 191-209)
   - Main entry point for publishing pipelines
   - Calls `canPostClip` and throws `PostingLimitExceededError` if violated
   - Used by `publish-tiktok.ts` and `publish-youtube.ts` pipelines

**TODOs Related to Plan Matrix Alignment:**

- Line 102: Explicit TODO comment: `// TODO (ME-I-04): Align with planMatrix limits and add to plan features`
- The function documentation (lines 89-99) mentions: "These are conservative defaults. ME-I-04 will align these with planMatrix and add plan-based enforcement."

### 1.2 How Limits Are Currently Defined

**Current Implementation:**

Posting limits are hardcoded in `getDefaultPostingLimitsForPlan()` using a `switch` statement:

```typescript
switch (planName) {
  case 'premium':
    return { maxPerDay: 50, minIntervalMs: 60_000 }; // 1 minute
  case 'pro':
    return { maxPerDay: 30, minIntervalMs: 120_000 }; // 2 minutes
  case 'basic':
  default:
    return { maxPerDay: 10, minIntervalMs: 300_000 }; // 5 minutes
}
```

**Current Hardcoded Limits:**

| Plan | Max Posts/Day | Min Interval |
|------|---------------|--------------|
| `basic` (default) | 10 | 5 minutes (300,000 ms) |
| `pro` | 30 | 2 minutes (120,000 ms) |
| `premium` | 50 | 1 minute (60,000 ms) |

**Usage Tracking and Comparison:**

1. **History Loading:** Publishing pipelines call `loadPostingHistory(workspaceId, accountId, platform)` to get recent posts
2. **Limit Retrieval:** `getDefaultPostingLimitsForPlan(planName)` returns limits for the plan
3. **Enforcement:** `enforcePostLimits()` is called before posting:
   - Filters history to last 24 hours
   - Counts posts in that window
   - Compares count to `limits.maxPerDay`
   - Checks time since last post against `limits.minIntervalMs`
   - Throws `PostingLimitExceededError` if violated

**Edge Cases Handled:**

- Unknown plan names default to `basic` limits
- `undefined` plan name defaults to `basic` limits
- History is filtered to rolling 24-hour window (not calendar day)

---

## 2. Current State — Plan Matrix

### 2.1 planMatrix Structure

The plan matrix is defined in `packages/shared/src/billing/planMatrix.ts`. It provides a centralized definition of plan capabilities and limits.

**Structure:**

```typescript
export interface PlanLimits extends PlanFeature {
  uploads_per_day: number;
  clips_per_project: number;
  max_team_members: number;
  storage_gb: number;
  concurrent_jobs: number;
  source_minutes_per_month?: number;
  clips_per_month?: number;
  projects_per_month?: number;
  posts_per_month?: number;  // Monthly limit, not daily
}

export interface PlanDefinition {
  limits: PlanLimits;
  description: string;
}

export const PLAN_MATRIX: PlanMatrix = {
  basic: { ... },
  pro: { ... },
  premium: { ... },
}
```

**Current Plan Definitions:**

| Plan | Key Limits (from planMatrix) |
|------|------------------------------|
| `basic` | `posts_per_month: 300` (~10/day), `uploads_per_day: 5`, `clips_per_project: 3` |
| `pro` | `posts_per_month: 900` (~30/day), `uploads_per_day: 30`, `clips_per_project: 12` |
| `premium` | `posts_per_month: 1500` (~50/day), `uploads_per_day: 150`, `clips_per_project: 40` |

**Posting Limits in Plan Matrix:**

- **`posts_per_month`** exists in `PlanLimits` (line 44)
- This is a **monthly limit** (not daily)
- The comment on line 40-43 notes: "posts_per_month limits are initial engine defaults and can be tuned later without affecting the rest of the billing system. They should be kept comfortably above the daily limits enforced by postingGuard (which are per-account, not per-workspace)."

**Gap Identified:**

- **Posting guard limits are NOT directly represented in planMatrix**
- `posts_per_month` is a monthly workspace limit, but posting guard needs:
  - **Daily per-account limits** (`maxPerDay`)
  - **Minimum interval between posts** (`minIntervalMs`)
- These two fields need to be added to `PlanLimits` interface and plan definitions

### 2.2 Gaps Between Posting Guard and Plan Matrix

**Current Disconnection:**

1. **Posting guard** uses hardcoded `switch` statement with plan names (`'basic'`, `'pro'`, `'premium'`)
2. **Plan matrix** has `posts_per_month` but no `maxPerDay` or `minIntervalMs` fields
3. **No shared source of truth** — limits are duplicated and can drift

**Plan Identifier Alignment:**

- **Posting guard** expects: `'basic' | 'pro' | 'premium' | undefined`
- **Plan matrix** uses: `PlanName` type (which is `'basic' | 'pro' | 'premium'`)
- These align, but posting guard doesn't import or use `PlanName` type

**Edge Cases:**

- **Unknown plan:** Posting guard defaults to `basic` limits (safe fallback)
- **Missing planMatrix entry:** Would cause runtime error if we try to read from planMatrix without checking
- **Null/undefined plan:** Posting guard handles this (defaults to `basic`)

**What Needs to Be Wired:**

1. Add `maxPerDay` and `minIntervalMs` fields to `PlanLimits` interface
2. Populate these fields in each plan definition in `PLAN_MATRIX`
3. Create helper function `getPostingLimitsForPlan(planName: PlanName): PostingLimits`
4. Update `getDefaultPostingLimitsForPlan()` to call the helper instead of using switch
5. Ensure backward compatibility (defaults if plan not found)

---

## 3. Current State — Cron Scan Schedules

### 3.1 Cron Endpoint Responsibilities

The cron endpoint lives in `apps/web/src/pages/api/cron/scan-schedules.ts`. It is responsible for:

**Primary Function:**
- Scanning the `schedules` table for due posts
- Atomically claiming schedules (status: `scheduled` → `processing`)
- Enqueuing publishing jobs for claimed schedules

**How It Finds Schedules to Process:**

1. **Query:** `UPDATE schedules SET status = 'processing' WHERE status = 'scheduled' AND run_at <= now() RETURNING *`
2. **Atomic Claiming:** Uses PostgreSQL UPDATE with WHERE clause to atomically claim due schedules
3. **Filters:** Only processes schedules with `status = 'scheduled'` and `run_at <= now()`

**How It Interacts with Posting Guard and Publish Pipelines:**

1. **Scanning:** `scanSchedules()` function (in `apps/web/src/lib/cron/scanSchedules.ts`) claims due schedules
2. **Account Resolution:** For each schedule, resolves connected accounts for the platform (TikTok/YouTube)
3. **Job Enqueuing:** Creates `PUBLISH_TIKTOK` or `PUBLISH_YOUTUBE` jobs via `enqueueJob()`
4. **Posting Guard:** Posting guard is enforced later when the worker processes the job (in `publish-tiktok.ts` or `publish-youtube.ts` pipelines)
5. **No Direct Interaction:** Cron doesn't call posting guard directly; it just enqueues jobs that will be checked later

**Authentication:**

The endpoint uses `isAuthorizedCronRequest()` which checks:
1. **X-CRON-SECRET header**
2. **Query parameter** (`?secret=...`)
3. **Bearer token** in Authorization header

Secrets checked:
- `CRON_SECRET` (from `serverEnv.CRON_SECRET`)
- `VERCEL_AUTOMATION_BYPASS_SECRET` (from `serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET`)

**Logging:**

- Structured logs for:
  - Start/end of scan (with `runId`)
  - Counts: `scanned`, `claimed`, `enqueued`, `enqueued_tiktok`, `enqueued_youtube`, `skipped`, `failed`
  - Errors during account resolution or job enqueuing
  - Duration in milliseconds

### 3.2 Deployment & Runtime Assumptions

**Expected Deployment Model:**

The code supports multiple deployment models:
- **Vercel Cron:** Can use `VERCEL_AUTOMATION_BYPASS_SECRET` for Vercel's cron system
- **External Scheduler:** Can call endpoint with `CRON_SECRET` in header/query/Bearer token
- **Manual Trigger:** Can be called manually with proper authentication

**Environment Variables Required:**

- `CRON_SECRET` (optional, but required for authentication)
- `VERCEL_AUTOMATION_BYPASS_SECRET` (optional, for Vercel cron)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for database access)

**Idempotency Expectations:**

- **Atomic Claiming:** Uses `UPDATE ... WHERE status = 'scheduled'` to prevent duplicate processing
- **Deduplication:** Job enqueuing uses `dedupeKey: ${schedule.id}-${accountId}` to prevent duplicate jobs
- **Status Tracking:** Schedules move from `scheduled` → `processing` → (job completes) → `completed` or `failed`

**Logging Conventions:**

- All logs use structured JSON format via `logger.info()` / `logger.error()` / `logger.warn()`
- Log events include:
  - `cron_scan_schedules_start` / `cron_scan_schedules_complete`
  - `cron_scan_schedules_claimed`
  - `cron_scan_schedules_enqueue_failed`
  - `cron_scan_schedules_schedule_error`
- Each log includes `runId` for correlation

**Error Handling:**

- Database errors during claiming throw and return 500
- Account resolution failures log warning and skip schedule (increment `skipped`)
- Job enqueuing failures log error and increment `failed`
- Individual schedule errors don't stop the entire scan

---

## 4. Design — Posting Guard Plan Alignment

### 4.1 Data Model for Posting Limits

**Proposed Structure:**

Add two fields to `PlanLimits` interface in `planMatrix.ts`:

```typescript
export interface PlanLimits extends PlanFeature {
  // ... existing fields ...
  
  /**
   * Maximum posts per day per account (enforced by posting guard).
   * This is a per-account limit, not per-workspace.
   * Should be comfortably below posts_per_month to allow for multiple accounts.
   */
  posting_max_per_day?: number;
  
  /**
   * Minimum milliseconds between consecutive posts per account (enforced by posting guard).
   * Prevents rapid-fire posting that could trigger platform rate limits.
   */
  posting_min_interval_ms?: number;
}
```

**Where It Lives:**

- In `packages/shared/src/billing/planMatrix.ts`
- As optional fields in `PlanLimits` interface
- Populated in each plan definition in `PLAN_MATRIX` constant

**How Each Plan's Limits Will Be Defined:**

```typescript
export const PLAN_MATRIX: PlanMatrix = {
  basic: {
    limits: {
      // ... existing fields ...
      posting_max_per_day: 10,
      posting_min_interval_ms: 300_000, // 5 minutes
    },
  },
  pro: {
    limits: {
      // ... existing fields ...
      posting_max_per_day: 30,
      posting_min_interval_ms: 120_000, // 2 minutes
    },
  },
  premium: {
    limits: {
      // ... existing fields ...
      posting_max_per_day: 50,
      posting_min_interval_ms: 60_000, // 1 minute
    },
  },
}
```

**Rationale for Optional Fields:**

- Makes migration safer (existing code doesn't break if fields are missing)
- Allows gradual rollout
- Provides fallback to hardcoded defaults if planMatrix doesn't have values

### 4.2 Helper API from Plan Matrix

**Design:**

Create a helper function in `planMatrix.ts`:

```typescript
/**
 * Returns posting limits for a given plan from the plan matrix.
 * 
 * @param planName - Plan tier: 'basic', 'pro', 'premium'
 * @returns Posting limits for the plan, or default limits if plan not found
 * 
 * @example
 * const limits = getPostingLimitsForPlan('pro');
 * // { maxPerDay: 30, minIntervalMs: 120_000 }
 */
export function getPostingLimitsForPlan(planName?: PlanName): PostingLimits {
  // Implementation details:
  // 1. If planName is undefined/null, default to 'basic'
  // 2. Look up plan in PLAN_MATRIX
  // 3. Extract posting_max_per_day and posting_min_interval_ms
  // 4. If fields are missing, fall back to hardcoded defaults (backward compatibility)
  // 5. Return PostingLimits object matching postingGuard.ts interface
}
```

**Input:**

- `planName: PlanName | undefined` — Plan identifier from billing system
- Type: `'basic' | 'pro' | 'premium' | undefined`

**Output:**

- `PostingLimits` — Object with `maxPerDay: number` and `minIntervalMs: number`
- Matches the interface expected by `postingGuard.ts`

**Defaulting/Fallback Behavior:**

1. **If planName is undefined/null:** Default to `'basic'` plan
2. **If plan not found in PLAN_MATRIX:** Default to `'basic'` limits
3. **If `posting_max_per_day` is missing:** Use hardcoded default for that plan tier
4. **If `posting_min_interval_ms` is missing:** Use hardcoded default for that plan tier
5. **Log warning** if plan not found or fields missing (for observability)

**Error Handling:**

- **Unknown plan:** Log warning, return `basic` limits (safe fallback)
- **Missing fields:** Log warning, return hardcoded defaults for that plan tier
- **No exceptions thrown** — always returns valid limits (defensive programming)

### 4.3 Changes to Posting Guard

**Refactoring `getDefaultPostingLimitsForPlan()`:**

**Current Implementation:**
```typescript
export function getDefaultPostingLimitsForPlan(planName?: string): PostingLimits {
  // TODO (ME-I-04): Align with planMatrix limits and add to plan features
  switch (planName) {
    case 'premium':
      return { maxPerDay: 50, minIntervalMs: 60_000 };
    case 'pro':
      return { maxPerDay: 30, minIntervalMs: 120_000 };
    case 'basic':
    default:
      return { maxPerDay: 10, minIntervalMs: 300_000 };
  }
}
```

**New Implementation:**
```typescript
import { getPostingLimitsForPlan as getPlanMatrixPostingLimits } from '../billing/planMatrix';

export function getDefaultPostingLimitsForPlan(planName?: string): PostingLimits {
  // Read limits from plan matrix (single source of truth)
  return getPlanMatrixPostingLimits(planName as PlanName | undefined);
}
```

**Changes Required:**

1. **Import:** Add import for `getPostingLimitsForPlan` from `planMatrix.ts`
2. **Remove hardcoded switch:** Replace entire switch statement with call to helper
3. **Remove TODO:** Delete TODO comment (line 102)
4. **Update documentation:** Update JSDoc to reflect plan matrix alignment

**Backward Compatibility:**

- **Function signature unchanged:** Still accepts `string | undefined`, returns `PostingLimits`
- **Behavior unchanged:** Still defaults to `basic` limits for unknown plans
- **Return type unchanged:** Still returns same `PostingLimits` interface
- **No breaking changes:** All callers continue to work without modification

**Logging When Plan is Unknown or Misconfigured:**

- **In `planMatrix.ts` helper:** Log warning if plan not found or fields missing
  - Event: `plan_matrix_posting_limits_missing`
  - Include: `planName`, `missingFields`
- **In `postingGuard.ts`:** No additional logging needed (helper handles it)
- **Log level:** `warn` (not `error`) since fallback behavior is safe

**Migration Path:**

1. **Phase 1 (T3-1b):** Add fields to planMatrix, create helper (types-only, no behavior change)
2. **Phase 2 (T3-1c):** Update posting guard to use helper (behavior change, but limits stay same)
3. **Phase 3 (T3-1d):** Add tests to verify plan matrix alignment
4. **Future:** Can adjust limits in planMatrix without touching posting guard code

---

## 5. Design — Cron Deployment Verification

### 5.1 What Needs to Be Verified

**Concrete Assertions Required:**

1. **Cron endpoint is deployed and reachable:**
   - Endpoint `/api/cron/scan-schedules` responds to POST requests
   - Returns 200 OK when authenticated correctly
   - Returns 403 FORBIDDEN when not authenticated

2. **CRON_SECRET is set and working:**
   - Environment variable `CRON_SECRET` is set in production
   - Endpoint accepts requests with `CRON_SECRET` in header/query/Bearer token
   - Endpoint rejects requests without valid secret

3. **Cron is actually scheduled:**
   - **If Vercel cron:** Check `vercel.json` for cron configuration
   - **If external scheduler:** Verify external service (e.g., cron-job.org, GitHub Actions) is configured
   - **If manual:** Document how to trigger manually

4. **Schedules created by users are being picked up:**
   - Create test schedule with `run_at` in near future
   - Wait for cron to execute (or trigger manually)
   - Verify schedule status changes: `scheduled` → `processing` → `completed`
   - Verify publishing job is enqueued and processed

**Verification Checklist:**

- [ ] Endpoint accessible: `curl -X POST https://<domain>/api/cron/scan-schedules?secret=<CRON_SECRET>`
- [ ] Returns 200 OK with JSON: `{ ok: true, scanned: N, claimed: N, enqueued: N, ... }`
- [ ] Returns 403 FORBIDDEN without secret
- [ ] Vercel cron config exists in `vercel.json` OR external scheduler is configured
- [ ] Test schedule executes successfully

### 5.2 Verification Flow

**Manual Verification Checklist:**

**Step 1: Verify Endpoint Accessibility**
1. Get `CRON_SECRET` from production environment
2. Call endpoint: `POST /api/cron/scan-schedules?secret=<CRON_SECRET>`
3. Verify response: `200 OK` with JSON body containing `ok: true`
4. Verify logs show `cron_scan_schedules_success` event

**Step 2: Create Test Scheduled Post**
1. Create a workspace (or use existing test workspace)
2. Create a clip in `ready` status
3. Create a schedule:
   - `clip_id`: ID of ready clip
   - `platform`: `'tiktok'` or `'youtube'`
   - `run_at`: 1-2 minutes in future (e.g., `new Date(Date.now() + 120000).toISOString()`)
   - `status`: `'scheduled'`
4. Verify schedule exists in database with correct `run_at`

**Step 3: Trigger or Wait for Cron**
- **If Vercel cron:** Wait for scheduled execution (check Vercel dashboard for cron logs)
- **If external scheduler:** Wait for scheduled execution OR trigger manually
- **If manual:** Call endpoint manually: `POST /api/cron/scan-schedules?secret=<CRON_SECRET>`

**Step 4: Verify Post Was Processed**
1. Check schedule status in database: Should be `processing` or `completed`
2. Check jobs table: Should have `PUBLISH_TIKTOK` or `PUBLISH_YOUTUBE` job
3. Check job status: Should be `claimed`, `processing`, or `completed`
4. Check logs: Should see `cron_scan_schedules_success` with `enqueued > 0`
5. **If posting guard blocks:** Verify error is logged and job fails with `PostingLimitExceededError`

**Automated Checks (Future, Not Required in T3):**

- **Health check endpoint:** Add `/api/cron/health` that verifies cron secret is set
- **Scheduled test:** Create test schedule daily, verify it executes
- **Monitoring:** Alert if cron hasn't run in 24 hours
- **Metrics:** Track cron execution frequency and success rate

### 5.3 Logging & Observability

**Desired Logs for Cron:**

**Cron Start/End:**
- **Event:** `cron_scan_schedules_start`
  - Fields: `runId`, `timestamp`
- **Event:** `cron_scan_schedules_complete` / `cron_scan_schedules_success`
  - Fields: `runId`, `scanned`, `claimed`, `enqueued`, `enqueued_tiktok`, `enqueued_youtube`, `skipped`, `failed`, `durationMs`

**Errors While Processing Schedules:**
- **Event:** `cron_scan_schedules_claim_failed`
  - Fields: `runId`, `error`
- **Event:** `cron_scan_schedules_accounts_failed`
  - Fields: `runId`, `scheduleId`, `platform`, `error`
- **Event:** `cron_scan_schedules_enqueue_failed`
  - Fields: `runId`, `scheduleId`, `accountId`, `platform`, `error`
- **Event:** `cron_scan_schedules_schedule_error`
  - Fields: `runId`, `scheduleId`, `error`

**Posting Guard Violations During Cron Processing:**

- **Not logged in cron:** Posting guard is enforced later when worker processes the job
- **Logged in worker:** When `publish-tiktok.ts` or `publish-youtube.ts` calls `enforcePostLimits()`, it throws `PostingLimitExceededError`
- **Worker logs:** Should include plan tier and limit details in error context

**How These Logs Help Debugging:**

1. **Cron not running:** Check for `cron_scan_schedules_start` events in logs (if missing, cron not executing)
2. **Schedules not processing:** Check `claimed` count (if 0, no schedules due or query failing)
3. **Jobs not enqueuing:** Check `enqueued` vs `claimed` (if `enqueued < claimed`, enqueue failures)
4. **Account resolution failures:** Check `skipped` count and `cron_scan_schedules_accounts_failed` events
5. **Posting guard violations:** Check worker logs for `PostingLimitExceededError` with plan tier details

**Structured Log Format:**

All logs use structured JSON format:
```json
{
  "event": "cron_scan_schedules_success",
  "runId": "uuid-here",
  "scanned": 5,
  "claimed": 5,
  "enqueued": 10,
  "enqueued_tiktok": 8,
  "enqueued_youtube": 2,
  "skipped": 0,
  "failed": 0,
  "durationMs": 1234,
  "timestamp": "2025-01-XXT..."
}
```

---

## 6. Test Strategy for T3

### 6.1 Posting Guard Alignment Tests

**Unit Tests for planMatrix Helper:**

**File:** `test/billing/planMatrix.postingLimits.test.ts` (new)

**Test Cases:**
1. **`getPostingLimitsForPlan('basic')` returns correct limits**
   - Verify `maxPerDay: 10`, `minIntervalMs: 300_000`
2. **`getPostingLimitsForPlan('pro')` returns correct limits**
   - Verify `maxPerDay: 30`, `minIntervalMs: 120_000`
3. **`getPostingLimitsForPlan('premium')` returns correct limits**
   - Verify `maxPerDay: 50`, `minIntervalMs: 60_000`
4. **`getPostingLimitsForPlan(undefined)` defaults to basic**
   - Verify returns basic limits
5. **`getPostingLimitsForPlan('unknown')` defaults to basic**
   - Verify returns basic limits and logs warning
6. **Missing fields fall back to hardcoded defaults**
   - Mock planMatrix with missing `posting_max_per_day`, verify fallback

**Unit Tests for Posting Guard with Plan-Based Limits:**

**File:** `test/engine/postingGuard.test.ts` (update existing)

**Test Cases:**
1. **`getDefaultPostingLimitsForPlan()` reads from planMatrix**
   - Mock `getPostingLimitsForPlan` from planMatrix, verify it's called
2. **Posting guard enforces plan-based limits correctly**
   - Test with `basic` plan: 10/day limit enforced
   - Test with `pro` plan: 30/day limit enforced
   - Test with `premium` plan: 50/day limit enforced
3. **Unknown plan defaults to basic limits**
   - Test with `'unknown'` plan, verify basic limits applied
4. **Minimum interval enforced per plan**
   - Test `basic`: 5 minute interval
   - Test `pro`: 2 minute interval
   - Test `premium`: 1 minute interval

**Integration Tests:**

**File:** `test/engine/postingGuard.integration.test.ts` (new or update existing)

**Test Cases:**
1. **Full flow: plan resolution → limit retrieval → enforcement**
   - Resolve workspace plan from billing
   - Get posting limits for plan
   - Enforce limits with posting history
   - Verify correct limits applied
2. **Posting guard works with real planMatrix**
   - Don't mock planMatrix, use real implementation
   - Verify limits match planMatrix definitions

### 6.2 Cron Behavior Tests

**Existing Tests:**

**File:** `test/api/cron.scan-schedules.test.ts`

**Current Coverage:**
- Endpoint authentication (CRON_SECRET required)
- Endpoint returns 403 without secret
- Endpoint returns 200 with secret
- `scanSchedules()` function logic:
  - Claims due schedules atomically
  - Enqueues jobs for claimed schedules
  - Handles missing accounts (skips schedule)
  - Handles enqueue failures (increments failed)
  - Returns correct counts

**Additional Tests That Might Be Warranted:**

1. **Concurrent cron execution (idempotency):**
   - Simulate two cron calls at same time
   - Verify no duplicate jobs enqueued
   - Verify schedules only claimed once

2. **Posting guard integration (if time permits):**
   - Create schedule that would violate posting guard
   - Verify job is enqueued (posting guard checked later in worker)
   - Verify worker logs posting guard violation

**What Will Remain Manual Verification Only:**

- **Production cron deployment:** Cannot test in CI (requires production access)
- **Vercel cron configuration:** Requires Vercel dashboard access
- **External scheduler configuration:** Requires external service access
- **End-to-end schedule execution:** Requires full production environment

**Test Strategy Summary:**

- **Unit tests:** Verify planMatrix helper and posting guard logic
- **Integration tests:** Verify planMatrix → posting guard flow
- **API tests:** Verify cron endpoint behavior (already exist)
- **Manual verification:** Production deployment and scheduling (T3-1e)

---

## 7. Risks, Edge Cases & Rollback

### 7.1 Risks & Edge Cases

**Risks:**

1. **Misconfigured planMatrix entries:**
   - **Risk:** If `posting_max_per_day` or `posting_min_interval_ms` are missing or invalid, posting guard may fail or use wrong limits
   - **Mitigation:** Helper function has fallback to hardcoded defaults, logs warnings
   - **Detection:** Log warnings when fields missing, monitor logs in production

2. **Unknown plan names coming from billing:**
   - **Risk:** If billing system returns plan name not in `PLAN_MATRIX`, posting guard may fail
   - **Mitigation:** Helper defaults to `basic` limits, logs warning
   - **Detection:** Log warnings for unknown plans, monitor logs

3. **Schedules created with invalid or legacy plan identifiers:**
   - **Risk:** If workspace has invalid plan, posting guard may use wrong limits
   - **Mitigation:** Plan resolution should validate plan name, posting guard has safe defaults
   - **Detection:** Log warnings when plan not found

4. **Plan matrix changes break posting guard:**
   - **Risk:** If planMatrix structure changes, posting guard may fail to read limits
   - **Mitigation:** Optional fields with fallbacks, TypeScript types catch structural changes
   - **Detection:** TypeScript compilation errors, unit tests

5. **Cron deployment misconfiguration:**
   - **Risk:** If cron not deployed or misconfigured, scheduled posts never execute
   - **Mitigation:** Manual verification (T3-1e), monitoring for cron execution
   - **Detection:** Missing `cron_scan_schedules_start` logs, user reports of schedules not executing

**Edge Cases:**

1. **Plan name is `null` or empty string:**
   - **Handling:** Helper treats as `undefined`, defaults to `basic`
2. **PlanMatrix missing for plan:**
   - **Handling:** Helper defaults to `basic`, logs warning
3. **Posting limits fields are `null` or `0`:**
   - **Handling:** Helper treats as missing, uses fallback defaults
4. **Multiple cron instances running simultaneously:**
   - **Handling:** Atomic UPDATE prevents duplicate processing, dedupeKey prevents duplicate jobs
5. **Schedule `run_at` is in past:**
   - **Handling:** Cron processes immediately (`.lte('run_at', now)`)

### 7.2 Rollback Plan

**Temporary Revert to Hardcoded Limits:**

**If planMatrix alignment causes issues:**

1. **Revert `postingGuard.ts`:**
   - Restore hardcoded `switch` statement
   - Remove import of `getPostingLimitsForPlan`
   - Restore TODO comment
   - **Time:** ~5 minutes
   - **Risk:** Low (just reverting to previous working code)

2. **Keep planMatrix changes:**
   - Don't revert planMatrix (fields are optional, won't break anything)
   - Helper function can remain (not used if posting guard reverted)

3. **Verify:**
   - Run tests: `pnpm test:core`
   - Verify posting guard works with hardcoded limits
   - Check logs for any errors

**Disable Cron Externally:**

**If cron misbehaves:**

1. **Vercel cron:**
   - Remove cron entry from `vercel.json`
   - Redeploy (cron stops executing)
   - **Time:** ~2 minutes
   - **Risk:** Low (just removing cron config)

2. **External scheduler:**
   - Disable cron job in external service (cron-job.org, GitHub Actions, etc.)
   - **Time:** ~1 minute
   - **Risk:** Low (just disabling external trigger)

3. **Keep code path intact:**
   - Don't modify `scan-schedules.ts` endpoint
   - Can still trigger manually if needed
   - Can re-enable cron once issue fixed

**Rollback Verification:**

- **Posting guard:** Test with hardcoded limits, verify behavior matches pre-change
- **Cron:** Verify cron stops executing (check logs for missing `cron_scan_schedules_start` events)
- **No data loss:** Rollback doesn't affect existing schedules or jobs

---

## 8. Recommended Next Steps

### 8.1 Mapping to T3 Substeps

**T3-1a (Current Step):** ✅ **Discovery & Design Doc Refresh**
- **Status:** Complete (this document)
- **Deliverable:** `REPORTS/T3-01-posting-guard-plan-alignment-design.md`

**T3-1b: Types-Only / planMatrix Helper**
- **Goal:** Add posting limit fields to planMatrix, create helper function
- **Files:**
  - `packages/shared/src/billing/planMatrix.ts` — Add `posting_max_per_day` and `posting_min_interval_ms` to `PlanLimits`, populate in `PLAN_MATRIX`, create `getPostingLimitsForPlan()` helper
- **Tests:** Unit tests for helper function
- **Risk:** Low (types-only, no behavior change)

**T3-1c: Posting Guard Implementation Changes**
- **Goal:** Update `getDefaultPostingLimitsForPlan()` to use planMatrix helper
- **Files:**
  - `packages/shared/src/engine/postingGuard.ts` — Replace switch with call to helper, remove TODO
- **Tests:** Update existing posting guard tests
- **Risk:** Medium (behavior change, but limits stay same)

**T3-1d: Tests for Plan Alignment**
- **Goal:** Add comprehensive tests for plan matrix alignment
- **Files:**
  - `test/billing/planMatrix.postingLimits.test.ts` (new)
  - `test/engine/postingGuard.test.ts` (update)
- **Tests:** Unit and integration tests
- **Risk:** Low (tests only)

**T3-1e: Cron Verification Docs**
- **Goal:** Verify cron deployment, document verification steps
- **Files:**
  - `REPORTS/T3-02-cron-deployment-verification.md` (new, optional)
  - `REPORTS/backend_ops_runbook.md` (update)
- **Tests:** Manual verification only
- **Risk:** Low (documentation only)

**T3-1f: Logging Polish**
- **Goal:** Ensure posting guard violations log plan tier, cron logs are comprehensive
- **Files:**
  - `packages/shared/src/engine/postingGuard.ts` — Update error messages to include plan tier
  - `apps/web/src/pages/api/cron/scan-schedules.ts` — Ensure structured logs include context
- **Tests:** Verify logs in test output
- **Risk:** Low (logging only)

**T3-1g: Final Report & Readiness Updates**
- **Goal:** Document completion, update delta tracking
- **Files:**
  - `REPORTS/T3-03-posting-guard-scheduling-complete.md` (new)
  - `REPORTS/backend_delta_to_done_cliply.md` (update)
- **Tests:** Documentation review
- **Risk:** Low (documentation only)

### 8.2 Immediate Next Step

**Recommended next step:** **T3-1b — Types-Only: Plan Matrix Posting Limits**

**Action:**
- Add `posting_max_per_day` and `posting_min_interval_ms` fields to `PlanLimits` interface
- Populate these fields in `PLAN_MATRIX` for each plan (basic, pro, premium)
- Create `getPostingLimitsForPlan(planName: PlanName): PostingLimits` helper function
- Add unit tests for helper function

**Why start here:**
- **No behavior change:** Types-only change, posting guard still uses hardcoded limits
- **Establishes foundation:** Plan matrix becomes source of truth for limits
- **Low risk:** Can be done independently, doesn't affect runtime behavior
- **Enables T3-1c:** Next step can simply call the helper instead of switch

**Expected outcome:**
- Plan matrix has posting limit fields
- Helper function exists and is tested
- Posting guard still works with hardcoded limits (no change yet)
- Ready for T3-1c to wire them together

---

**End of Design Document**

