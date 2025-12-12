# T3-00 — Next Backend Readiness Track Selection & Plan

**Status:** Planning (Documentation Only)  
**Created:** 2025-01-XX  
**Purpose:** Identify the next backend readiness track to tackle and create a detailed implementation plan

---

## 1. Inputs Reviewed

### 1.1 Reports Analyzed

**Primary Reports:**
- `REPORTS/backend_build_tracks_cliply.md` — Comprehensive track organization with 6 tracks (T1-T6)
- `REPORTS/backend_delta_to_done_cliply.md` — 23 delta items across 11 capabilities
- `REPORTS/backend_feature_completeness_cliply.md` — Capability-by-capability status assessment
- `REPORTS/backend_repo_inventory_cliply.md` — Codebase structure and module inventory

**Implementation Plans:**
- `REPORTS/T1-02-youtube-client-implementation-plan.md` — YouTube client implementation (completed)
- `REPORTS/T2-00-tiktok-client-plan.md` — TikTok client standardization (completed)

### 1.2 Key Findings from Reports

**From `backend_build_tracks_cliply.md`:**
- **T1 (YouTube Publishing)**: Partially blocked — D-01 can start, D-02 needs Person 2 verification
- **T2 (RLS & Access Model)**: Partially blocked — Core RLS work (H-01, C-01, E-04) requires Person 2
- **T3 (Posting Guard & Scheduling Reliability)**: ✅ **Ready** — Fully unblocked, all Person 1 owned
  - E-01: Align posting guard limits with plan matrix (High, Code, P1)
  - E-02: Verify schedule scanning cron deployment (High, Ops, P1)
  - E-03: CRON_SECRET env key exists (Medium, Env, P1) — Already implemented
- **T4 (Clip Classification)**: Ready but needs product decision
- **T5 (Deployment & Ops)**: Mix of Person 1/2, Person 1 items can proceed
- **T6 (Licensing)**: Ready, low priority

**From `backend_delta_to_done_cliply.md`:**
- **E-01 (High, Code, P1)**: Posting guard limits need plan matrix alignment
  - Status: Partially implemented
  - Evidence: TODO comment in `packages/shared/src/engine/postingGuard.ts` (line 102)
  - Current: Hardcoded limits (basic: 10/day, pro: 30/day, premium: 50/day)
  - Target: Read from `planMatrix.ts` instead
- **E-02 (High, Ops, P1)**: Schedule scanning cron deployment verification
  - Status: Unknown
  - Evidence: Cron endpoint exists at `apps/web/src/pages/api/cron/scan-schedules.ts`
  - Target: Verify cron is deployed and running in production
- **E-03 (Medium, Env, P1)**: CRON_SECRET env key
  - Status: ✅ Implemented
  - Evidence: `packages/shared/src/env.ts` includes CRON_SECRET

**From `backend_feature_completeness_cliply.md`:**
- **Capability E (Scheduling & Anti-spam)**: 🟡 Yellow (Medium Confidence)
  - Schedule scanning cron endpoint exists
  - Posting guard implemented with plan-based limits (TODO for plan matrix alignment)
  - Schedules table with proper schema
  - Tests exist for schedule scanning and posting guard

**Remaining Work Summary:**
- **T3 Track**: 2 high-severity deltas (E-01, E-02) + 1 medium (E-03, already done)
- **T1 Track**: 2 blocker deltas (D-01, D-02) — D-01 can start, D-02 blocked on Person 2
- **T2 Track**: 1 high + 3 medium deltas — Blocked on Person 2 RLS verification
- **T4 Track**: 3 medium deltas — Needs product decision
- **T5 Track**: Mix of Person 1/2 items — Person 1 items can proceed independently
- **T6 Track**: 3 low-severity deltas — Low priority

---

## 2. Candidate Tracks

### 2.1 Candidate 1: T3 — Posting Guard & Scheduling Reliability

**Name:** Posting Guard & Scheduling Reliability

**Description:**
Align posting guard rate limits with plan matrix (replacing hardcoded values) and verify that the schedule scanning cron job is deployed and running in production. This ensures scheduled posts execute reliably and rate limits match plan tiers correctly.

**Why it matters for MVP readiness:**
- **Scheduled posts are core functionality** — Users expect scheduled posts to execute automatically
- **Rate limits must match plan tiers** — Incorrect limits could block paying customers or allow abuse
- **High user impact** — If cron isn't deployed, scheduled posts never execute (silent failure)
- **Revenue protection** — Plan-based limits are tied to billing tiers

**Current state:**
- **E-01**: Partially implemented — Posting guard has hardcoded limits with TODO comment
- **E-02**: Unknown — Cron endpoint exists but deployment not verified
- **E-03**: ✅ Implemented — CRON_SECRET env key exists

**Dependencies:**
- ✅ Plan matrix is stable (`packages/shared/src/billing/planMatrix.ts`)
- ✅ Cron endpoint exists (`apps/web/src/pages/api/cron/scan-schedules.ts`)
- ✅ Posting guard implementation exists (`packages/shared/src/engine/postingGuard.ts`)
- ✅ Tests exist for both components

**Person 1 readiness:** ✅ Fully unblocked

---

### 2.2 Candidate 2: T1 — YouTube Publishing & OAuth Completion

**Name:** YouTube Publishing & OAuth Completion

**Description:**
Implement real YouTube Data API v3 client to replace stubbed implementation and verify Google OAuth callback flow is complete.

**Why it matters for MVP readiness:**
- **YouTube publishing is non-functional** — Currently returns fake video IDs
- **Blocker severity** — Users cannot publish to YouTube
- **Multi-platform requirement** — MVP needs both TikTok and YouTube

**Current state:**
- **D-01**: Missing — YouTube client is stubbed (`dryrun_${uuid}`)
- **D-02**: Unknown — OAuth callback needs Person 2 verification
- **D-04**: Missing — E2E test for YouTube publishing

**Dependencies:**
- ⚠️ **D-02 blocks completion** — Cannot fully test YouTube client without working OAuth flow
- ✅ TikTok client pattern exists as reference (T2 completed)

**Person 1 readiness:** ⚠️ Partially blocked — D-01 can start, but D-02 requires Person 2

---

### 2.3 Candidate 3: T5 — Deployment, Ops & Production Hardening

**Name:** Deployment, Ops & Production Hardening

**Description:**
Document migration application process, verify deployment pipeline completeness, verify Sentry configuration, and verify Stripe configuration (Person 2 items).

**Why it matters for MVP readiness:**
- **Operational clarity** — Developers need to know how to deploy safely
- **Production reliability** — Sentry and Stripe must be configured correctly
- **Risk reduction** — Undocumented processes lead to errors

**Current state:**
- **J-01**: Missing — Migration process not documented
- **J-02**: Unknown — Deployment pipeline needs verification
- **I-01**: Unknown — Sentry config needs verification
- **F-01, F-02**: Unknown — Stripe config needs Person 2 verification

**Dependencies:**
- ✅ No code dependencies
- ⚠️ Requires production access for verification
- ⚠️ Some items require Person 2 (Stripe)

**Person 1 readiness:** ⚠️ Partially ready — Person 1 items can proceed, but some require Person 2

---

### 2.4 Candidate 4: T4 — Clip Classification & Tagging

**Name:** Clip Classification & Tagging

**Description:**
Implement clip classification/tagging feature to allow users to tag clips with emotions/categories (exciting, sad, happy, etc.).

**Why it matters for MVP readiness:**
- **Feature completeness** — May be required for v1 depending on product decision
- **User organization** — Helps users organize and filter clips

**Current state:**
- **B-01**: Missing — No classification implementation found
- **B-02**: Missing — No classification schema
- **B-03**: Missing — No classification tests

**Dependencies:**
- ⚠️ **Product decision required** — Is classification needed for v1?
- ✅ No Person 2 dependencies

**Person 1 readiness:** ⚠️ Blocked on product decision

---

## 3. Chosen Next Track for T3

**Track:** **T3 — Posting Guard & Scheduling Reliability**

### 3.1 Why This Track?

**Impact on MVP users:**
- **Scheduled posts are essential** — Users schedule posts expecting them to execute automatically. If cron isn't deployed, scheduled posts never execute (silent failure, high user frustration).
- **Rate limits affect user experience** — If limits don't match plan tiers, users may be incorrectly blocked or allowed to exceed their plan limits, leading to billing issues or abuse.
- **High visibility** — Users directly interact with scheduling and posting features daily.

**Dependencies on completed work:**
- ✅ **Plan matrix is stable** — `planMatrix.ts` exists and is well-tested
- ✅ **Posting guard implementation exists** — Just needs plan matrix integration
- ✅ **Cron endpoint exists** — `scan-schedules.ts` is implemented and tested
- ✅ **TikTok/YouTube clients completed** — T1 and T2 provide patterns for reliability work

**Risk reduction for backend-readiness-v1:**
- **Prevents silent failures** — Cron deployment verification ensures scheduled posts actually execute
- **Prevents billing issues** — Plan-aligned limits ensure users get what they pay for
- **Reduces support burden** — Correct rate limits prevent user confusion and support tickets
- **Foundation for scaling** — Reliable scheduling is critical as user base grows

**Unblocked status:**
- ✅ **Fully Person 1 owned** — No Person 2 dependencies
- ✅ **No external blockers** — All dependencies (plan matrix, cron endpoint) exist
- ✅ **Clear TODO in code** — E-01 has explicit TODO comment pointing to solution
- ✅ **Production verification only** — E-02 is verification, not implementation

**Priority alignment:**
- **2 High-severity deltas** (E-01, E-02) — Higher priority than medium/low items
- **Critical path for MVP** — Scheduling is core functionality
- **Low risk** — Well-defined scope, existing implementations to build on

---

## 4. Scope & Non-Goals for T3

### 4.1 Scope

**What this track will ensure technically:**

1. **Posting guard limits align with plan matrix:**
   - `getDefaultPostingLimitsForPlan()` reads limits from `planMatrix.ts` instead of hardcoded values
   - Plan-based limits correctly applied (basic/pro/premium tiers)
   - TODO comment removed from `postingGuard.ts`
   - Unit tests verify plan-based limits work correctly

2. **Schedule scanning cron is deployed and running:**
   - Cron endpoint is accessible in production
   - Cron job is configured (Vercel cron or external service)
   - CRON_SECRET is set and working
   - Manual verification confirms cron executes scheduled posts

3. **Observability and documentation:**
   - Structured logs for posting guard violations include plan tier details
   - Cron scan failures are logged with context
   - Runbook updated with posting guard and cron troubleshooting

**Success criteria:**
- Scheduled posts execute automatically via cron (verified in production)
- Posting guard enforces plan-based limits (basic: 10/day, pro: 30/day, premium: 50/day)
- Users cannot exceed their plan's posting limits
- Clear error messages when limits are exceeded
- Cron failures are logged and recoverable

### 4.2 Non-Goals

**What this track explicitly will NOT do:**

- ❌ **RLS verification** — T2 track (H-01, C-01, E-04) handles workspace member access
- ❌ **YouTube client implementation** — T1 track (D-01) handles YouTube API integration
- ❌ **Clip classification** — T4 track (B-01, B-02, B-03) handles classification feature
- ❌ **Deployment documentation** — T5 track (J-01, J-02) handles migration and deployment docs
- ❌ **Stripe configuration** — T5 track (F-01, F-02) handles Stripe verification (Person 2)
- ❌ **Posting guard algorithm changes** — Only aligning limits with plan matrix, not changing logic
- ❌ **Cron implementation** — Cron endpoint already exists, only verifying deployment
- ❌ **Multi-platform scheduling** — Only verifying existing cron works, not adding new platforms

**MVP-appropriate focus:**
- Keep scope narrow: plan alignment + cron verification
- No new features, only reliability improvements
- Build on existing implementations

---

## 5. Implementation Substeps for T3

### T3-1a — Discovery & Design Doc Refresh

**Goal:**
Review current posting guard implementation, plan matrix structure, and cron endpoint to create detailed design for plan alignment and cron verification.

**Expected files to touch:**
- `REPORTS/T3-01-posting-guard-plan-alignment-design.md` (new)
  - Document current posting guard implementation
  - Document plan matrix structure and how to read posting limits
  - Design plan alignment approach
  - Document cron endpoint structure and deployment verification steps

**Risk level:** Low

**Rollback strategy:**
- Delete design doc, no runtime impact

---

### T3-1b — Types-Only: Plan Matrix Posting Limits

**Goal:**
Add posting limit definitions to plan matrix types (if not already present) and create helper functions to read posting limits from plan matrix.

**Expected files to touch:**
- `packages/shared/src/billing/planMatrix.ts`
  - Verify/add posting limit fields to plan definitions
  - Add helper function: `getPostingLimitsForPlan(planName: string): PostingLimits`
- `packages/shared/src/engine/postingGuard.ts`
  - Import plan matrix helper
  - (No changes to posting guard logic yet, just types/helpers)

**Risk level:** Low

**Rollback strategy:**
- Revert plan matrix changes, posting guard still uses hardcoded values

---

### T3-1c — Implementation: Posting Guard Plan Alignment

**Goal:**
Update `getDefaultPostingLimitsForPlan()` to read from plan matrix instead of hardcoded switch statement.

**Expected files to touch:**
- `packages/shared/src/engine/postingGuard.ts`
  - Replace hardcoded switch statement with plan matrix lookup
  - Remove TODO comment (line 102)
  - Ensure backward compatibility (defaults if plan not found)

**Risk level:** Medium

**Rollback strategy:**
- Revert to hardcoded switch statement
- Posting guard continues to work with hardcoded values

---

### T3-1d — Tests: Posting Guard Plan Alignment

**Goal:**
Add unit tests verifying posting guard uses plan matrix limits correctly.

**Expected files to touch:**
- `test/engine/postingGuard.test.ts` (update existing)
  - Test plan matrix limits are correctly applied
  - Test basic/pro/premium tiers have correct limits
  - Test fallback behavior for unknown plans
  - Test integration with plan matrix

**Risk level:** Low

**Rollback strategy:**
- Revert test changes, no runtime impact

---

### T3-1e — Cron Deployment Verification & Documentation

**Goal:**
Verify cron endpoint is deployed and accessible, document deployment process, and update runbook.

**Expected files to touch:**
- `REPORTS/backend_ops_runbook.md` (update)
  - Add section on cron deployment verification
  - Document how to verify cron is running
  - Add troubleshooting steps for cron failures
- `REPORTS/T3-02-cron-deployment-verification.md` (new, optional)
  - Document verification steps taken
  - Document cron configuration (Vercel or external)
  - Document CRON_SECRET setup

**Risk level:** Low (documentation only)

**Rollback strategy:**
- Revert documentation changes, no runtime impact

---

### T3-1f — Logging & Telemetry Polish

**Goal:**
Ensure posting guard violations log plan tier details and cron scan failures are logged with context.

**Expected files to touch:**
- `packages/shared/src/engine/postingGuard.ts`
  - Update error messages to include plan tier
  - Ensure structured logs include plan details
- `apps/web/src/pages/api/cron/scan-schedules.ts`
  - Ensure structured logs include context (workspace IDs, schedule counts, errors)
  - Add Sentry integration for cron failures

**Risk level:** Low

**Rollback strategy:**
- Revert logging changes, functionality unchanged

---

### T3-1g — Final Report & Gating Update

**Goal:**
Create completion report documenting what was done and update any gating flags if needed.

**Expected files to touch:**
- `REPORTS/T3-03-posting-guard-scheduling-complete.md` (new)
  - Document completion of E-01 and E-02
  - Document verification results
  - Update readiness status
- `REPORTS/backend_delta_to_done_cliply.md` (update, if needed)
  - Mark E-01 and E-02 as complete

**Risk level:** Low

**Rollback strategy:**
- Revert report changes, no runtime impact

---

## 6. Readiness & Acceptance Criteria for T3

### 6.1 Posting Guard Plan Alignment (E-01)

**Tests:**
- ✅ Unit tests verify `getDefaultPostingLimitsForPlan()` reads from plan matrix
- ✅ Tests verify basic/pro/premium tiers have correct limits from plan matrix
- ✅ Tests verify fallback behavior for unknown plans
- ✅ `test:core` remains green
- ✅ Integration tests verify posting guard enforces plan-based limits

**Code:**
- ✅ `postingGuard.ts` reads limits from `planMatrix.ts` (no hardcoded values)
- ✅ TODO comment removed (line 102)
- ✅ Plan-based limits correctly applied in publishing pipelines

**Logging:**
- ✅ Posting guard violations log plan tier and limit details
- ✅ Error messages include plan information

**Documentation:**
- ✅ Runbook updated with posting guard troubleshooting
- ✅ Design doc documents plan alignment approach

---

### 6.2 Cron Deployment Verification (E-02)

**Verification:**
- ✅ Cron endpoint is accessible in production (`/api/cron/scan-schedules`)
- ✅ CRON_SECRET is set and working (endpoint accepts authenticated requests)
- ✅ Cron job is configured (Vercel cron or external service)
- ✅ Manual test: Create scheduled post, verify it executes via cron

**Logging:**
- ✅ Cron scan failures are logged with context (workspace IDs, schedule counts, errors)
- ✅ Sentry captures cron failures with context

**Documentation:**
- ✅ Runbook updated with cron deployment verification steps
- ✅ Cron configuration documented (Vercel or external service)
- ✅ Troubleshooting steps documented

---

### 6.3 Manual Verification Flow

**Test scenario:**
1. Create a scheduled post for a workspace (scheduled 1 minute in future)
2. Wait for cron to execute (or trigger manually with CRON_SECRET)
3. Verify post is enqueued and published
4. Verify posting guard enforces plan limits (try to exceed plan limit, verify error)

**Success criteria:**
- Scheduled post executes automatically via cron
- Posting guard blocks posts exceeding plan limits
- Error messages are clear and include plan information
- Logs show plan tier and limit details

---

## 7. Suggested Step to Start With

**Recommended next step:** **T3-1a — Discovery & Design Doc Refresh**

**Action:**
- Create `REPORTS/T3-01-posting-guard-plan-alignment-design.md` with detailed design for:
  - Current posting guard implementation analysis
  - Plan matrix structure and how to read posting limits
  - Plan alignment approach (how to integrate plan matrix into posting guard)
  - Cron endpoint structure and deployment verification steps
  - Test strategy for plan alignment

**Why start here:**
- No runtime changes in this step (documentation only)
- Establishes clear design before implementation
- Allows review of approach before coding
- Low risk, can be done quickly

**Next Cursor prompt:**
> Create `REPORTS/T3-01-posting-guard-plan-alignment-design.md` with detailed design for posting guard plan alignment and cron deployment verification. Review `packages/shared/src/engine/postingGuard.ts`, `packages/shared/src/billing/planMatrix.ts`, and `apps/web/src/pages/api/cron/scan-schedules.ts` to understand current implementation.

---

**End of Plan**

