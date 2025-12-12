# Backend Build Tracks — Cliply Engine Surface

**Purpose**: Execution tracks (T1–T6) grouping deltas from `backend_delta_to_done_cliply.md` into logical work units with Cursor vs Manual split.  
**Date**: 2025-12-12  
**Branch**: `engine-surface-setup`  
**How Tracks Were Formed**: Derived from `backend_delta_to_done_cliply.md` by grouping related deltas by functional area and dependency chain.

---

## Track Overview

| Track | Description | Deltas | Owner |
|-------|-------------|--------|-------|
| **T1** | Endpoint Routing & Test Coverage | DELTA-ES-001, DELTA-ES-004, DELTA-ES-008 | Person-2 |
| **T2** | Billing & Usage Integration | DELTA-ES-002, DELTA-ES-003, DELTA-ES-006 | Person-2 |
| **T3** | CI/CD Readiness Gates | DELTA-ES-005 | Person-2 |
| **T4** | Plan-Based Posting Limits (Shared) | DELTA-ES-007 | Shared |
| **T5** | Observability & Monitoring | (No deltas) | N/A |
| **T6** | Worker/Engine Pipeline | (No deltas) | N/A |

---

## T1: Endpoint Routing & Test Coverage

**Description**: Fix endpoint routing/deployment issues causing 404s, add missing test coverage for upload/complete and cron endpoints.

**Deltas Included**: DELTA-ES-001, DELTA-ES-004, DELTA-ES-008

### Cursor Work

1. **Investigate Next.js routing configuration**
   - Check `next.config.js` for basePath, rewrites, or routing overrides
   - Verify `apps/web/src/pages/api/` structure matches Next.js Pages Router expectations
   - Check for middleware conflicts (`apps/web/src/middleware/`)
   - Files: `next.config.js`, `apps/web/src/middleware/*.ts`

2. **Fix endpoint routing issues**
   - Ensure all endpoints in `apps/web/src/pages/api/` are properly exported as default handlers
   - Verify dynamic routes (`[id]`) are correctly structured
   - Test locally: `pnpm dev` and verify endpoints respond (not 404)
   - Files: All endpoint files in `apps/web/src/pages/api/`

3. **Add upload/complete test coverage**
   - Create `test/api/upload-complete.test.ts` or extend existing upload test file
   - Test cases: successful completion → job enqueue, concurrent_jobs plan gate, invalid projectId, rate limiting
   - Files: `test/api/upload-complete.test.ts` (new or existing)

4. **Improve cron endpoint error handling**
   - Update `/api/cron/scan-schedules` to return 503 (not 500) when env vars missing
   - Add clear error message indicating which env vars are required
   - Files: `apps/web/src/pages/api/cron/scan-schedules.ts`

### Manual Work

1. **Manual smoke testing**
   - Run full smoke test sequence from `engine_surface_api_flows_smoke_checklist_2025-12-11.md`
   - Verify all endpoints return 200 with JSON (not 404 HTML)
   - Document any remaining routing issues

2. **Environment configuration**
   - Verify `.env.example` documents all required Supabase vars for cron endpoint
   - Test cron endpoint with and without env vars set
   - Update local dev setup documentation if needed

3. **Deployment verification**
   - If deploying to staging/production, verify endpoints are accessible in deployed environment
   - Check deployment platform (Vercel/other) routing configuration

### Dependencies

- **Person-1**: None
- **External**: Next.js deployment platform configuration (if applicable)

### Track DoD

- [ ] All endpoints from DELTA-ES-001 return 200 (not 404) in manual smoke test
- [ ] `test/api/upload-complete.test.ts` exists and all tests pass
- [ ] Cron endpoint returns 503 (not 500) when env vars missing
- [ ] `.env.example` documents required Supabase vars
- [ ] CI `backend-core` job passes (endpoints accessible)

---

## T2: Billing & Usage Integration

**Description**: Integrate posts usage tracking into publish flows, add billing checkout test coverage, harden Stripe webhook error handling.

**Deltas Included**: DELTA-ES-002, DELTA-ES-003, DELTA-ES-006

### Cursor Work

1. **Wire usageTracker into publish endpoints**
   - Add `assertWithinUsage(workspaceId, 'posts', 1)` before enqueueing publish jobs in `/api/publish/tiktok` and `/api/publish/youtube`
   - Add `recordUsage(workspaceId, 'posts', 1)` after successful job enqueue
   - Handle `UsageLimitExceededError` with appropriate HTTP status (429)
   - Files: `apps/web/src/pages/api/publish/tiktok.ts`, `apps/web/src/pages/api/publish/youtube.ts`

2. **Remove posts usage placeholder in usageService**
   - Remove TODO comments for posts calculation
   - Implement real posts usage calculation using `usageTracker.getUsageSummary()`
   - Ensure posts limits come from `PLAN_MATRIX`
   - Files: `apps/web/src/lib/billing/usageService.ts`

3. **Add billing checkout test coverage**
   - Create `test/api/billing.checkout.test.ts` or extend existing billing test file
   - Test cases: happy path (valid priceId → checkoutUrl), invalid priceId error, idempotency header reuse, rate limiting, Stripe session metadata validation
   - Files: `test/api/billing.checkout.test.ts` (new or existing)

4. **Harden Stripe webhook error handling**
   - Add test cases for missing workspace_id scenarios
   - Add test cases for invalid webhook signatures
   - Add test cases for multi-price subscription handling
   - Ensure all webhook event handlers have try/catch with proper error logging
   - Files: `apps/web/src/pages/api/webhooks/stripe.ts`, `apps/web/src/lib/billing/stripeHandlers.ts`, `test/api/webhooks.stripe.test.ts`

### Manual Work

1. **Stripe CLI integration testing**
   - Set up Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   - Test real webhook events from Stripe dashboard (checkout.session.completed, subscription events, invoice events)
   - Verify webhook signature validation works correctly
   - Document Stripe CLI setup for future testing

2. **Manual billing flow verification**
   - Test complete checkout flow: `/api/billing/checkout` → Stripe checkout page → webhook → `/api/billing/status`
   - Verify posts usage is tracked correctly after publishing
   - Verify usage limits are enforced when posting quota exceeded

### Dependencies

- **Person-1**: None (usageTracker already supports 'posts' metric per evidence)
- **External**: Stripe test mode account, Stripe CLI for webhook testing

### Track DoD

- [ ] Publish endpoints call `assertWithinUsage` and `recordUsage` for 'posts' metric
- [ ] `usageService.ts` posts calculation removes TODO and uses real usage data
- [ ] `test/api/billing.checkout.test.ts` exists and all tests pass
- [ ] Stripe webhook tests cover missing workspace_id, invalid signatures, multi-price subscriptions
- [ ] Manual Stripe CLI webhook testing passes
- [ ] Manual billing flow verification passes

---

## T3: CI/CD Readiness Gates

**Description**: Transition CI readiness check from Stage A (non-blocking) to Stage B (hard requirement) once endpoints are accessible.

**Deltas Included**: DELTA-ES-005

### Cursor Work

1. **Remove continue-on-error from CI**
   - Remove `continue-on-error: true` from `backend:readyz` step in `.github/workflows/ci.yml`
   - Ensure `backend:readyz` step fails the job if readiness checks fail
   - Files: `.github/workflows/ci.yml` (line 50-52)

2. **Verify readiness endpoints are accessible**
   - Ensure `/api/readyz` and `/api/admin/readyz` return 200 (not 404)
   - This should be verified as part of T1 (DELTA-ES-001)

### Manual Work

1. **CI verification**
   - Push changes to `engine-surface-setup` branch
   - Verify CI `backend-core` job runs `backend:readyz` and fails if endpoints are down
   - Verify CI passes when all readiness checks pass

2. **Local readiness check**
   - Run `pnpm backend:readyz` locally and verify it passes
   - Test readiness check failure scenarios (e.g., stop database, remove env vars)

### Dependencies

- **Person-1**: None
- **External**: CI secrets configured (SUPABASE_*, STRIPE_*)

### Track DoD

- [ ] `.github/workflows/ci.yml` no longer has `continue-on-error: true` on `backend:readyz` step
- [ ] `/api/readyz` and `/api/admin/readyz` return 200 (verified in T1)
- [ ] CI `backend-core` job fails if `backend:readyz` reports failures
- [ ] CI `backend-core` job passes when all readiness checks pass
- [ ] `pnpm backend:readyz` passes locally

---

## T4: Plan-Based Posting Limits (Shared)

**Description**: Integrate real workspace plans into posting guard, add posting fields to planMatrix, enforce workspace-level posting quotas.

**Deltas Included**: DELTA-ES-007

**Owner**: Shared (Person-1 + Person-2 coordination)

### Cursor Work (Person-2 Portion)

1. **Update publish pipelines to fetch workspace plan**
   - Modify `apps/worker/src/pipelines/publish-tiktok.ts` to fetch workspace plan from database
   - Modify `apps/worker/src/pipelines/publish-youtube.ts` to fetch workspace plan from database
   - Pass plan to `getDefaultPostingLimitsForPlan()` or new plan-based function
   - Files: `apps/worker/src/pipelines/publish-tiktok.ts`, `apps/worker/src/pipelines/publish-youtube.ts`

2. **Update posting guard to accept plan-based limits**
   - Modify `packages/shared/src/engine/postingGuard.ts` to accept plan-based limits (not just defaults)
   - Add workspace-level posting quota check via `usageTracker` in addition to per-account limits
   - Files: `packages/shared/src/engine/postingGuard.ts`

3. **Add posting guard tests for plan-based limits**
   - Update `test/engine/postingGuard.test.ts` to test plan-based limits (not just defaults)
   - Test workspace-level quota enforcement
   - Files: `test/engine/postingGuard.test.ts`

### Manual Work

1. **Coordinate with Person-1**
   - Verify `planMatrix.ts` includes `posts_per_day` and `posts_per_month` fields
   - Verify `usageTracker.ts` supports workspace-level posts quota checking
   - Test integration end-to-end once Person-1 changes are complete

### Dependencies

- **Person-1**: Must add `posts_per_day` and `posts_per_month` to `PLAN_MATRIX` in `packages/shared/src/billing/planMatrix.ts`
- **Person-1**: Must ensure `usageTracker` supports workspace-level posts quota (may already exist per evidence)
- **External**: None

### Track DoD

- [ ] Person-1: `planMatrix.ts` includes `posts_per_day` and `posts_per_month` fields
- [ ] Person-1: `usageTracker` supports workspace-level posts quota checking
- [ ] Person-2: Publish pipelines fetch workspace plan and pass to posting guard
- [ ] Person-2: Posting guard accepts plan-based limits and enforces workspace quotas
- [ ] Posting guard tests verify plan-based limits (not just defaults)
- [ ] Manual end-to-end test: Posting respects plan limits and workspace quotas

---

## T5: Observability & Monitoring

**Status**: No deltas evidenced in current REPORTS set.

**Note**: `observability_baseline_2025-12-11.md` indicates Stage A observability implementation is complete (health endpoints, structured logging, Sentry breadcrumbs). Stage B enhancements (external monitoring SaaS, log aggregation, metrics collection) are future work not requiring immediate deltas for Engine Surface completion.

---

## T6: Worker/Engine Pipeline

**Status**: No deltas evidenced in current REPORTS set.

**Note**: Worker pipeline changes are outside Engine Surface scope. Engine Surface focuses on API endpoints, billing, and CI/CD. Worker pipeline work is tracked separately in ER-* (Engine Reliability) and EI-* (Engine Integration) reports.

---

## Recommended Execution Order

Based on evidence and surface criticality:

### Phase 1: Foundation (T1)
**Rationale**: Endpoints must be accessible before other work can be verified. This is the blocking dependency for all other tracks.

1. **T1: Endpoint Routing & Test Coverage**
   - Fix 404s (DELTA-ES-001)
   - Add upload/complete tests (DELTA-ES-004)
   - Fix cron endpoint error handling (DELTA-ES-008)

### Phase 2: Core Integration (T2)
**Rationale**: Billing and usage integration is critical for paying user flows. Can proceed in parallel with T3 once T1 is complete.

2. **T2: Billing & Usage Integration**
   - Wire posts usage into publish flows (DELTA-ES-002)
   - Add checkout test coverage (DELTA-ES-003)
   - Harden webhook error handling (DELTA-ES-006)

### Phase 3: CI/CD Hardening (T3)
**Rationale**: CI readiness gates ensure quality before merge. Can proceed in parallel with T2 once T1 is complete.

3. **T3: CI/CD Readiness Gates**
   - Transition to Stage B (DELTA-ES-005)

### Phase 4: Advanced Features (T4)
**Rationale**: Plan-based posting limits require Person-1 coordination. Should be done after core Engine Surface work (T1–T3) is complete.

4. **T4: Plan-Based Posting Limits (Shared)**
   - Coordinate with Person-1 on planMatrix changes
   - Integrate plan-based limits into posting guard (DELTA-ES-007)

### Summary Execution Order

```
T1 (Foundation) → T2 + T3 (Parallel) → T4 (Advanced)
```

**Critical Path**: T1 → T2 → T4 (if T4 depends on T2 usage integration)

**Parallel Work**: T2 and T3 can be done in parallel once T1 is complete.

---

## Track Completion Criteria

A track is considered complete when:

1. All deltas in the track have verification checkboxes marked
2. All Cursor work items are implemented
3. All Manual work items are verified
4. All DoD checkboxes are marked
5. CI passes for the track's changes
6. Manual smoke testing (where applicable) passes

---

## Notes

- **T5 and T6**: No work required for Engine Surface completion. These tracks are documented for completeness but have no evidenced deltas.
- **Shared Work (T4)**: Requires coordination between Person-1 and Person-2. Person-1 owns core planMatrix/usageTracker changes; Person-2 owns integration into publish pipelines.
- **Dependencies**: T1 is a hard dependency for T2 and T3. T4 can proceed after T1–T3 are complete, but may benefit from T2 usage integration work.
