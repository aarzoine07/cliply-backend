# ✅ EI-03: Posting Anti-Spam Guard — COMPLETE

## Summary

Successfully implemented ME-I-03 by creating a robust posting guard system that prevents spam posting across TikTok and YouTube platforms. The system enforces per-account daily posting limits and minimum intervals between posts, with plan-based defaults.

## Implementation Overview

### Core Anti-Spam Features

The posting guard provides two layers of protection:

1. **Daily Limit:** Maximum posts per 24-hour rolling window per account
2. **Minimum Interval:** Enforced time gap between consecutive posts per account

### Algorithm

```typescript
// For each publish attempt:
1. Load posting history (last 24 hours) from variant_posts
2. Compute posting limits based on plan tier
3. Check:
   - Daily limit: count of posts in last 24h < maxPerDay
   - Min interval: time since last post >= minIntervalMs
4. If violated: throw PostingLimitExceededError
5. If allowed: proceed with posting
```

### Plan-Based Defaults

| Plan    | Max/Day | Min Interval |
|---------|---------|--------------|
| Basic   | 10      | 5 minutes    |
| Pro     | 30      | 2 minutes    |
| Premium | 50      | 1 minute     |

## Files Created

### 1. `packages/shared/src/engine/postingGuard.ts` (225 lines)

**Purpose:** Pure engine module for posting rate limiting

**Key Exports:**

- **`PostHistoryEvent`** — Posting event record
  ```typescript
  {
    workspaceId: string;
    accountId: string;
    platform: string;
    clipId: string;
    postedAt: Date;
  }
  ```

- **`PostingLimits`** — Rate limit configuration
  ```typescript
  {
    maxPerDay: number;
    minIntervalMs: number;
  }
  ```

- **`PostingLimitExceededError`** — Typed error class
  - `code: 'POSTING_LIMIT_EXCEEDED'`
  - `reason: 'DAILY_LIMIT' | 'MIN_INTERVAL'`
  - `platform`, `accountId`, `remainingMs?`

- **`getDefaultPostingLimitsForPlan(planName?)`** — Returns plan-based limits
- **`canPostClip(options)`** — Pure check function (advisory)
- **`enforcePostLimits(options)`** — Enforcement function (throws on violation)

**Key Properties:**
- ✅ **Pure functions:** No side effects, fully testable
- ✅ **Rolling 24h window:** Counts posts dynamically, not calendar-day based
- ✅ **Deterministic:** Same inputs → same outputs
- ✅ **Millisecond precision:** Accurate interval calculations

### 2. `test/engine/postingGuard.test.ts` (427 lines)

**Purpose:** Comprehensive test suite for posting guard

**Test Coverage (30 tests):**

- ✅ **Plan-based limits** (5 tests)
  - Basic, Pro, Premium tier limits
  - Default fallback for undefined/unknown plans

- ✅ **Under limits** (3 tests)
  - Empty history → allowed
  - Well under daily limit → allowed
  - Minimum interval elapsed → allowed

- ✅ **Daily limit exceeded** (3 tests)
  - Blocks when at/over limit
  - Only counts last 24 hours
  - Excludes older posts

- ✅ **Minimum interval violated** (3 tests)
  - Blocks when too soon after last post
  - Checks most recent post only
  - Accurate remainingMs calculation

- ✅ **Boundary cases** (3 tests)
  - Exact interval boundary → allowed
  - Exactly 24h ago → still counts
  - Millisecond precision

- ✅ **enforcePostLimits** (3 tests)
  - Throws on daily limit
  - Throws on interval violation
  - No throw when allowed

- ✅ **PostingLimitExceededError** (8 tests)
  - Correct error code, reason, platform, accountId
  - RemainingMs included for MIN_INTERVAL
  - Default messages
  - Custom messages
  - instanceof Error

- ✅ **Integration scenarios** (2 tests)
  - Multiple platforms independently
  - Combined constraints

## Files Modified

### 3. `apps/worker/src/pipelines/publish-tiktok.ts`

**Changes:**

- **Imports:** Added `enforcePostLimits`, `getDefaultPostingLimitsForPlan`, `PostHistoryEvent`, `PostingLimitExceededError`
- **Load posting history:** New `fetchPostingHistory()` helper
  - Queries `variant_posts` for last 24h of posts by account
  - Joins with `clips` to filter by workspace
  - Returns `PostHistoryEvent[]`
- **Compute limits:** `getDefaultPostingLimitsForPlan(planName)`
  - TODO: ME-I-04 will integrate real plan from workspace
- **Enforce guard:** Calls `enforcePostLimits()` before posting
  - Throws `PostingLimitExceededError` if violated
  - Logs `posting_guard_checked` on success
  - Logs `posting_guard_limit_exceeded` on violation
- **Error handling:** Catches `PostingLimitExceededError`, logs, re-throws

**Integration Point:** Between account fetch and video download

**Logging Events:**
- `posting_guard_checked`: Guard passed
  - `historyCount`, `limits`, `accountId`, `platform`
- `posting_guard_limit_exceeded`: Guard failed
  - `reason`, `remainingMs`, `accountId`, `platform`

### 4. `apps/worker/src/pipelines/publish-youtube.ts`

**Changes:** Same as TikTok pipeline

- Added posting guard enforcement
- New `fetchPostingHistory()` helper
- Plan-based limit computation
- Structured logging

**Platform:** `'youtube_shorts'` (not just `'youtube'`)

## Algorithm Details

### Posting History Query

```sql
SELECT clip_id, posted_at, clips.workspace_id
FROM variant_posts
INNER JOIN clips ON clips.id = variant_posts.clip_id
WHERE connected_account_id = ?
  AND platform = ?
  AND status = 'posted'
  AND posted_at IS NOT NULL
  AND posted_at >= NOW() - INTERVAL '24 hours'
ORDER BY posted_at DESC
```

**Optimization:**
- Scoped to single account
- Single platform
- Last 24 hours only
- Indexed on `connected_account_id`, `status`, `posted_at`

### Daily Limit Check

```typescript
const recent = history.filter((event) => 
  event.postedAt.getTime() >= nowMs - 24 * 60 * 60 * 1000
);
if (recent.length >= limits.maxPerDay) {
  throw PostingLimitExceededError('DAILY_LIMIT');
}
```

**Behavior:**
- Rolling 24h window (not calendar day)
- Posts exactly 24h ago still count (inclusive)
- Only posts with `status='posted'` count

### Minimum Interval Check

```typescript
const last = recent.reduce((latest, event) =>
  event.postedAt > latest.postedAt ? event : latest
);
const deltaMs = nowMs - last.postedAt.getTime();
if (deltaMs < limits.minIntervalMs) {
  throw PostingLimitExceededError('MIN_INTERVAL', remainingMs);
}
```

**Behavior:**
- Checks only most recent post
- Millisecond precision
- Provides `remainingMs` for user feedback

## Test Results

### New Posting Guard Tests
✅ **30/30 tests passing**

```bash
pnpm test test/engine/postingGuard.test.ts --run
# Test Files  1 passed (1)
# Tests  30 passed (30)
# Duration  950ms
```

### Regression Tests

✅ **Previous engine tests:** All passing
```bash
pnpm test test/engine/clipCount.test.ts --run      # 30/30 ✅
pnpm test test/engine/clipOverlap.test.ts --run    # 26/26 ✅
pnpm test test/api/clips.list.test.ts --run        # 11/11 ✅
```

### Build Verification

✅ **Shared package:** Builds successfully
✅ **Worker app:** Builds successfully with posting guard integration

## Error Handling

### PostingLimitExceededError

**Properties:**
```typescript
{
  code: 'POSTING_LIMIT_EXCEEDED',
  reason: 'DAILY_LIMIT' | 'MIN_INTERVAL',
  platform: string,
  accountId: string,
  remainingMs?: number, // Only for MIN_INTERVAL
  message: string
}
```

**Default Messages:**
- `DAILY_LIMIT`: "Daily posting limit reached for this account (tiktok)."
- `MIN_INTERVAL`: "Minimum interval between posts has not elapsed yet (tiktok)."

**Pipeline Handling:**
1. Guard throws `PostingLimitExceededError`
2. Pipeline catches, logs `posting_guard_limit_exceeded`
3. Re-throws for surface code to handle

**Surface Code (Future):**
- Can catch `PostingLimitExceededError`
- Check `error.code === 'POSTING_LIMIT_EXCEEDED'`
- Return appropriate HTTP status (e.g., 429 Too Many Requests)
- Include `remainingMs` in response for retry-after

## Observability

### New Log Events

**`posting_guard_checked`** (info)
```json
{
  "pipeline": "PUBLISH_TIKTOK",
  "workspaceId": "ws-abc",
  "accountId": "acc-123",
  "platform": "tiktok",
  "historyCount": 5,
  "limits": { "maxPerDay": 10, "minIntervalMs": 300000 }
}
```

**`posting_guard_limit_exceeded`** (warn)
```json
{
  "pipeline": "PUBLISH_TIKTOK",
  "workspaceId": "ws-abc",
  "accountId": "acc-123",
  "platform": "tiktok",
  "reason": "MIN_INTERVAL",
  "remainingMs": 180000
}
```

**Interpretation:**
- `historyCount: 5` → Account posted 5 times in last 24h
- `reason: MIN_INTERVAL` → Too soon after last post
- `remainingMs: 180000` → Need to wait 3 more minutes

## Integration with Previous Work

**EI-01 (Clip Count):**
- `computeMaxClipsForVideo()` → smart clip generation
- **EI-03:** Guards how often clips are posted (different concern)

**EI-02 (Overlap):**
- `consolidateClipCandidates()` → clean, non-overlapping clips
- **EI-03:** Ensures clips are posted responsibly across time

**Result:** Complete pipeline from clip generation → posting with quality + anti-spam controls

## Limitations & Future Work (ME-I-04)

### Current Implementation

✅ Uses default plan limits (`basic` hardcoded)
✅ No `posts` metric in `usageTracker` yet
✅ No per-workspace posting quotas (only per-account)

### TODO for ME-I-04

```typescript
// TODO (ME-I-04): integrate real plan-based limits using planMatrix
// 1. Fetch workspace plan from DB
// 2. Get limits from PLAN_MATRIX (add posting fields)
// 3. Add 'posts' metric to usageTracker
// 4. Track workspace-level posting quotas (not just per-account)
```

**Proposed Changes:**
1. **planMatrix:** Add `posts_per_day`, `posts_per_month` to `PlanLimits`
2. **usageTracker:** Add `'posts'` metric type
3. **postingGuard:** Accept plan-based limits from workspace
4. **Workspace-level quotas:** Check both account AND workspace limits

## Schema Requirements

### Existing Tables (No Changes)

**`variant_posts`:**
- ✅ `connected_account_id` (for account filtering)
- ✅ `platform` (tiktok, youtube_shorts)
- ✅ `status` ('posted')
- ✅ `posted_at` (timestamp for history)
- ✅ `clip_id` (for join to workspace)

**`clips`:**
- ✅ `workspace_id` (for filtering)
- ✅ `published_at` (set on successful publish)

**Indexes:**
- ✅ `idx_variant_posts_account` on `connected_account_id`
- ✅ `idx_variant_posts_status` on `status`

**Query Performance:**
- Fast: scoped to 24h, single account, indexed columns
- No N+1: single query with join
- Scales: independent per account

## Acceptance Criteria

✅ **`packages/shared/src/engine/postingGuard.ts` created** with:
- `PostHistoryEvent`, `PostingLimits`, `PostingLimitExceededError`
- `getDefaultPostingLimitsForPlan`, `canPostClip`, `enforcePostLimits`

✅ **`test/engine/postingGuard.test.ts` created** with:
- 30 tests covering daily limits, intervals, boundaries, errors
- All tests passing

✅ **`apps/worker/src/pipelines/publish-tiktok.ts` updated** with:
- `fetchPostingHistory()` from variant_posts
- Posting limit enforcement before upload
- Structured logging (`posting_guard_checked`, `posting_guard_limit_exceeded`)
- `PostingLimitExceededError` re-thrown for surface code

✅ **`apps/worker/src/pipelines/publish-youtube.ts` updated** with:
- Same integration as TikTok
- Platform: `'youtube_shorts'`

✅ **All previous tests passing:**
- `test/engine/clipCount.test.ts`: 30/30 ✅
- `test/engine/clipOverlap.test.ts`: 26/26 ✅
- `test/api/clips.list.test.ts`: 11/11 ✅

✅ **No HTTP surface changes**

✅ **Builds successfully:** Shared + Worker compile without errors

## Example Usage Scenario

### Scenario: TikTok Account Posts 10th Clip (Basic Plan)

**Initial State:**
- Workspace on `basic` plan (10/day limit, 5min interval)
- TikTok account posted 9 clips in last 24h
- Last post was 10 minutes ago

**Publish Attempt #10:**
1. Worker fetches posting history → 9 posts
2. Computes limits → `{ maxPerDay: 10, minIntervalMs: 300_000 }`
3. Checks: `9 < 10` ✅, `10min > 5min` ✅
4. Logs `posting_guard_checked`
5. **Proceeds with upload** ✅

**Publish Attempt #11 (2 minutes later):**
1. Worker fetches posting history → 10 posts
2. Checks: `10 >= 10` ❌
3. **Throws `PostingLimitExceededError(reason: 'DAILY_LIMIT')`**
4. Logs `posting_guard_limit_exceeded`
5. **Upload blocked** ❌

**Publish Attempt #11 (25 hours later):**
1. Worker fetches posting history → 0 posts (oldest rolled off)
2. Checks: `0 < 10` ✅
3. **Proceeds with upload** ✅

## Next Steps

**ME-I-04 (recommended):** Plan-Based Posting Limits
- Add `posts` metric to usageTracker
- Integrate real workspace plan fetching
- Add posting fields to planMatrix
- Workspace-level posting quotas

**ME-I-05:** Posting Analytics
- Track posting patterns per account
- Identify underutilized accounts
- Suggest optimal posting times

**ME-I-06:** Dynamic Rate Limiting
- Adjust limits based on account health
- Slow down on API errors
- Increase limits for high-engagement accounts

All acceptance criteria met! 🎉

