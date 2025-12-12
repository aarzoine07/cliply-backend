# Backend Delta-to-Done Checklist — Cliply Engine Surface

**Purpose**: Evidence-based delta checklist for completing Engine Surface integration work.  
**Date**: 2025-12-12  
**Branch**: `engine-surface-setup`  
**How Derived**: Extracted from existing REPORTS/ audit findings, smoke test results, and CI delivery audit observations.

## Source Index

This document is derived from the following evidence sources:

1. `REPORTS/engine_surface_api_flows_smoke_results_2025-12-11.md` — Manual smoke test showing 404s for multiple endpoints
2. `REPORTS/engine_surface_ci_delivery_audit_2025-12-11.md` — Posts usage placeholder, publish flows not using usageTracker, checkout test gaps
3. `REPORTS/billing_e2e_flow_2025-12-11.md` — Test gaps: checkout not directly covered, idempotency edge cases, Stripe CLI integration
4. `REPORTS/ci_behavior_plan_2025-12-11.md` — Readiness 404 handling, Stage A vs Stage B approach
5. `REPORTS/ci_workflow_audit_2025-12-11.md` — CI readiness check expectations
6. `REPORTS/EI-03-posting-anti-spam-guard-complete.md` — TODO for plan-based limits integration (Shared dependency)

---

## Delta List

### DELTA-ES-001: Endpoint Routing/Deployment Exposure

**Track**: T1  
**Owner**: Person-2  
**Problem Statement**: Multiple Engine Surface API endpoints return 404 during manual smoke testing, despite code existing in `apps/web/src/pages/api/`. This indicates a routing or deployment configuration issue preventing endpoints from being accessible.

**Target Behavior**: All Engine Surface endpoints should respond with JSON API responses (not Next.js 404 HTML pages) when accessed via their documented paths.

**Current Evidence**:
- **Report**: `engine_surface_api_flows_smoke_results_2025-12-11.md`, lines 18-24, 44-46, 57-59, 69-71, 79-81, 89-91, 103-105, 115-117, 124-126, 133-135, 150-152, 178-180, 184-185
- **Quote**: "Overall status: SOME ISSUES – core health endpoint is OK, but most engine surface APIs are currently returning 404 on this branch. /api/upload/init and /api/upload/complete return a Next.js 404 HTML page instead of JSON API responses – routes are missing or mounted differently."
- **Affected Endpoints**:
  - `/api/upload/init` (code: `apps/web/src/pages/api/upload/init.ts`)
  - `/api/upload/complete` (code: `apps/web/src/pages/api/upload/complete.ts`)
  - `/api/clips/[id]/approve` (code: `apps/web/src/pages/api/clips/[id]/approve.ts`)
  - `/api/clips/[id]/meta` (code: `apps/web/src/pages/api/clips/[id]/meta.ts`)
  - `/api/clips/[id]/reject` (code: `apps/web/src/pages/api/clips/[id]/reject.ts`)
  - `/api/publish/tiktok` (code: `apps/web/src/pages/api/publish/tiktok.ts`)
  - `/api/publish/youtube` (code: `apps/web/src/pages/api/publish/youtube.ts`)
  - `/api/billing/status` (code: `apps/web/src/pages/api/billing/status.ts`)
  - `/api/billing/usage` (code: `apps/web/src/pages/api/billing/usage.ts`)
  - `/api/billing/checkout` (code: `apps/web/src/pages/api/billing/checkout.ts`)
  - `/api/readyz` (code: `apps/web/src/pages/api/readyz.ts`)
  - `/api/admin/readyz` (code: `apps/web/src/pages/api/admin/readyz.ts`)

**Verification**:
- Manual smoke test: All listed endpoints return 200 with JSON responses (not 404 HTML)
- Run smoke test sequence from `engine_surface_api_flows_smoke_checklist_2025-12-11.md`
- Verify Next.js routing configuration (check `next.config.js`, middleware, basePath settings)
- Verify deployment configuration if applicable

---

### DELTA-ES-002: Posts Usage Tracking Integration in Publish Flows

**Track**: T2  
**Owner**: Person-2  
**Problem Statement**: Publish endpoints (`/api/publish/tiktok`, `/api/publish/youtube`) do not consult `usageTracker` for posts usage enforcement, even though `usageTracker` supports the `'posts'` metric. Additionally, `usageService.ts` has a TODO placeholder for posts usage calculation.

**Target Behavior**: Publish endpoints should call `usageTracker.assertWithinUsage()` and `usageTracker.recordUsage()` for the `'posts'` metric before enqueueing publish jobs, enforcing workspace-level posting quotas.

**Current Evidence**:
- **Report**: `engine_surface_ci_delivery_audit_2025-12-11.md`, lines 23, 26, 28, 43
- **Quote**: "Upload init invokes usage checks and records projects; publish endpoints currently do not enforce usage beyond plan gates." and "posts bucket currently placeholder (TODO comments, defaults posts=0 used with static limits map)" and "publish flows do not consult usageTracker"
- **Relevant Files**:
  - `apps/web/src/pages/api/publish/tiktok.ts`
  - `apps/web/src/pages/api/publish/youtube.ts`
  - `apps/web/src/lib/billing/usageService.ts` (TODO for posts)
  - `packages/shared/src/billing/usageTracker.ts` (supports 'posts' metric)

**Verification**:
- Code review: Publish endpoints call `assertWithinUsage(workspaceId, 'posts', 1)` before enqueueing
- Code review: Publish endpoints call `recordUsage(workspaceId, 'posts', 1)` after successful job enqueue
- Test: Add test case in `test/api/publish.*.test.ts` verifying posts usage enforcement
- Test: Verify `usageService.ts` posts calculation removes TODO and uses real usage data

---

### DELTA-ES-003: Billing Checkout Endpoint Test Coverage

**Track**: T2  
**Owner**: Person-2  
**Problem Statement**: `/api/billing/checkout` endpoint lacks direct test coverage. Current tests cover status/usage paths but not checkout session creation, idempotency behavior, or error handling for checkout-specific scenarios.

**Target Behavior**: Comprehensive test suite for `/api/billing/checkout` covering happy path, invalid price IDs, idempotency edge cases, rate limiting, and Stripe session creation validation.

**Current Evidence**:
- **Report**: `engine_surface_ci_delivery_audit_2025-12-11.md`, line 15
- **Quote**: "Tests: `billing.status.test.ts`, `billing.edge-cases.test.ts` cover status/usage paths; checkout not directly covered here."
- **Report**: `billing_e2e_flow_2025-12-11.md`, lines 160-163
- **Quote**: "Test Gaps Identified: Idempotency edge cases: Checkout session reuse scenarios not fully tested"
- **Relevant Files**:
  - `apps/web/src/pages/api/billing/checkout.ts`
  - `test/api/billing.*.test.ts` (needs checkout test file)

**Verification**:
- Test file exists: `test/api/billing.checkout.test.ts` or checkout tests in existing billing test file
- Test cases: Happy path (valid priceId → checkoutUrl), invalid priceId error, idempotency header reuse, rate limiting, Stripe session metadata validation
- Run: `pnpm test test/api/billing.checkout.test.ts` (or equivalent) passes

---

### DELTA-ES-004: Upload Complete Endpoint Test Coverage

**Track**: T1  
**Owner**: Person-2  
**Problem Statement**: `/api/upload/complete` endpoint lacks direct test coverage. Tests exist for `/api/upload/init` but not for the complete flow.

**Target Behavior**: Test suite for `/api/upload/complete` covering successful completion, job enqueueing, plan gating (concurrent_jobs), and error handling.

**Current Evidence**:
- **Report**: `engine_surface_ci_delivery_audit_2025-12-11.md`, line 12
- **Quote**: "Tests: `upload-init.test.ts` (pages router handler), `upload.edge-cases.test.ts` (coverage on payload/env/rate-limit), engine flow integration touches approve path; no direct test seen for `/upload/complete`."
- **Relevant Files**:
  - `apps/web/src/pages/api/upload/complete.ts`
  - `apps/web/test/api/upload-init.test.ts` (exists, but no complete test)

**Verification**:
- Test file exists: `test/api/upload-complete.test.ts` or tests added to existing upload test file
- Test cases: Successful completion → TRANSCRIBE job enqueued, concurrent_jobs plan gate, invalid projectId error, rate limiting
- Run: `pnpm test test/api/upload-complete.test.ts` (or equivalent) passes

---

### DELTA-ES-005: CI Readiness Check Stage A to Stage B Transition

**Track**: T3  
**Owner**: Person-2  
**Problem Statement**: `backend:readyz` script in CI currently uses `continue-on-error: true` (Stage A) because readiness endpoints return 404. Once endpoints are accessible, CI should transition to Stage B (hard requirement) that fails on readiness failures.

**Target Behavior**: CI `backend-core` job should fail if `backend:readyz` reports failures (Stage B), ensuring deployment readiness is validated before merge.

**Current Evidence**:
- **Report**: `ci_behavior_plan_2025-12-11.md`, lines 65-73
- **Quote**: "Current issue: `backend:readyz` script checks endpoints like `/api/readyz` that return 404 on engine-surface-setup branch. Stage A (now): Keep `backend:readyz` in core job but make it non-blocking on this branch. Stage B (later): Once all readiness endpoints are implemented and passing locally, make `backend:readyz` a hard requirement that fails the core job on any 404s or readiness failures."
- **Report**: `ci_workflow_audit_2025-12-11.md`, line 70
- **Quote**: "Readiness check may fail - pnpm run backend:readyz likely fails on current branch (404s for /api/readyz based on smoke test results)"
- **Relevant Files**:
  - `.github/workflows/ci.yml` (backend-core job, line 50-52: `continue-on-error: true`)

**Verification**:
- CI config: Remove `continue-on-error: true` from `backend:readyz` step in `.github/workflows/ci.yml`
- Smoke test: `/api/readyz` and `/api/admin/readyz` return 200 (not 404)
- CI run: `backend-core` job fails if `backend:readyz` reports failures
- Manual: Run `pnpm backend:readyz` locally and verify it passes

---

### DELTA-ES-006: Stripe Webhook Invoice/Error Handling Hardening

**Track**: T2  
**Owner**: Person-2  
**Problem Statement**: Stripe webhook handler processes `invoice.payment_succeeded/failed` events, but test coverage and error handling for edge cases (missing workspace_id, invalid signatures, multi-price subscriptions) may be incomplete.

**Target Behavior**: Comprehensive error handling and test coverage for all webhook event types, including graceful degradation for missing metadata and proper audit logging for all billing events.

**Current Evidence**:
- **Report**: `billing_e2e_flow_2025-12-11.md`, lines 160-163
- **Quote**: "Test Gaps Identified: Real Stripe CLI integration: Current tests use mocks; live webhook testing requires Stripe CLI. Idempotency edge cases: Checkout session reuse scenarios not fully tested. Multi-price subscriptions: Tests focus on single-price subscriptions."
- **Report**: `billing_e2e_flow_2025-12-11.md`, line 152
- **Quote**: "Error handling (missing workspace_id, invalid signatures)"
- **Relevant Files**:
  - `apps/web/src/pages/api/webhooks/stripe.ts`
  - `apps/web/src/lib/billing/stripeHandlers.ts`
  - `test/api/webhooks.stripe.test.ts`

**Verification**:
- Test: Add test cases for missing workspace_id scenarios, invalid webhook signatures, multi-price subscription handling
- Code review: Verify all webhook event handlers have try/catch with proper error logging
- Manual: Test with Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`) for real webhook events
- Audit logs: Verify all billing events (including errors) are logged to audit trail

---

### DELTA-ES-007: Plan-Based Posting Limits Integration (Shared Dependency)

**Track**: T4  
**Owner**: Shared (Person-1 + Person-2 coordination)  
**Not Owned by Person-2**: This is a dependency visibility item. Person-2 should coordinate with Person-1 on plan integration, but Person-1 owns the planMatrix/usageTracker core changes.

**Problem Statement**: Posting guard (EI-03) currently uses hardcoded plan defaults. It should integrate with real workspace plans from `planMatrix` and workspace-level posting quotas via `usageTracker`.

**Target Behavior**: Posting guard fetches workspace plan from database, uses `PLAN_MATRIX` for posting limits, and enforces workspace-level `posts` quotas via `usageTracker` in addition to per-account limits.

**Current Evidence**:
- **Report**: `EI-03-posting-anti-spam-guard-complete.md`, lines 328-336
- **Quote**: "TODO for ME-I-04: integrate real plan-based limits using planMatrix. 1. Fetch workspace plan from DB. 2. Get limits from PLAN_MATRIX (add posting fields). 3. Add 'posts' metric to usageTracker. 4. Track workspace-level posting quotas (not just per-account)."
- **Report**: `engine_surface_ci_delivery_audit_2025-12-11.md`, line 43
- **Quote**: "Epic 4 – Stripe, PLAN_MATRIX & onboarding flow: align `PLAN_MATRIX` with Stripe price IDs (especially posts limits), wire usageTracker into publish/job creation"
- **Relevant Files**:
  - `packages/shared/src/billing/planMatrix.ts` (needs posting fields)
  - `packages/shared/src/engine/postingGuard.ts` (needs plan integration)
  - `apps/worker/src/pipelines/publish-tiktok.ts` (needs workspace plan fetch)
  - `apps/worker/src/pipelines/publish-youtube.ts` (needs workspace plan fetch)

**Verification**:
- Code review: `planMatrix.ts` includes `posts_per_day` and `posts_per_month` fields
- Code review: `postingGuard.ts` accepts plan-based limits (not just defaults)
- Code review: Publish pipelines fetch workspace plan and pass to posting guard
- Test: Posting guard tests verify plan-based limits (not just defaults)
- **Note**: This delta requires Person-1 changes to `planMatrix.ts` and `usageTracker.ts` before Person-2 can integrate

---

### DELTA-ES-008: Cron Endpoint Environment Configuration

**Track**: T1  
**Owner**: Person-2  
**Problem Statement**: `/api/cron/scan-schedules` endpoint exists and routes correctly, but fails with 500 error due to missing Supabase environment variables in local/dev environment.

**Target Behavior**: Endpoint should handle missing environment variables gracefully (return 503 with clear error message) or documentation should clarify required env vars for local testing.

**Current Evidence**:
- **Report**: `engine_surface_api_flows_smoke_results_2025-12-11.md`, lines 160-165
- **Quote**: "Endpoint exists at `/api/cron/scan-schedules` and runs through the API handler, but fails early on env validation because required Supabase environment variables are not set in the current dev environment. This is an environment/configuration issue, not a routing problem; to be fixed when we wire proper SUPABASE_* values for local/dev in a later epic."
- **Relevant Files**:
  - `apps/web/src/pages/api/cron/scan-schedules.ts`
  - `.env.example` (should document required vars)

**Verification**:
- Code review: Endpoint returns 503 (not 500) when env vars missing, with clear error message
- Documentation: `.env.example` includes all required Supabase vars for cron endpoint
- Manual: Endpoint works when env vars are set, returns appropriate error when missing

---

## Tracks with No Evidenced Deltas

### T5: Observability & Monitoring
**Status**: No deltas evidenced in current REPORTS set.  
**Note**: Observability baseline report (`observability_baseline_2025-12-11.md`) indicates Stage A implementation is complete. Stage B enhancements (external monitoring SaaS, log aggregation) are future work not requiring immediate deltas.

### T6: Worker/Engine Pipeline
**Status**: No deltas evidenced in current REPORTS set.  
**Note**: Worker pipeline changes are outside Engine Surface scope. Engine Surface focuses on API endpoints, billing, and CI/CD. Worker pipeline work is tracked separately in ER-* and EI-* reports.

---

## Summary

**Total Deltas**: 8  
**Person-2 Owned**: 7 (DELTA-ES-001 through DELTA-ES-006, DELTA-ES-008)  
**Shared/Dependency**: 1 (DELTA-ES-007, requires Person-1 coordination)  
**Tracks Covered**: T1 (3 deltas), T2 (3 deltas), T3 (1 delta), T4 (1 delta, shared)  
**Tracks Empty**: T5, T6 (no evidenced deltas)
