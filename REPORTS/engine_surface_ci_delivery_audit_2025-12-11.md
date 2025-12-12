# Engine Surface CI & Delivery Audit – 2025-12-11

## 1. CI Overview
- Workflows: `.github/workflows/ci.yml` runs on `push`/`pull_request` to `main, dev`.
  - `backend-core` (critical for readiness): pnpm install → `check:env` → `check:env:template` → `typecheck` → `build` → `backend:readyz` → `test:core`. Secrets/env: `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
  - `extended-tests`: pnpm install → `pnpm test` (apps/web vitest config) → `pnpm test:coverage` → upload coverage. Env: Supabase test secrets.
- Root scripts referenced: `check:env` (`scripts/check-env.ts`), `check:env:template`, `typecheck` (tsc -b), `build` (pnpm -r build), `backend:readyz` (tsx scripts/backend.readiness.ts), `test:core` (vitest run test/api/healthz.test.ts test/shared), `test` (vitest run apps/web/vitest.config.ts), `test:coverage` (vitest --coverage).
- Workspace scripts relevant to CI: `apps/web/package.json` has `build`, `typecheck`, `lint`, `test`; `packages/shared` has `build`, `typecheck`, `lint`. CI does not call lint explicitly.
- Observations: `extended-tests` runs `pnpm test` and again `pnpm test:coverage` (full suite twice). No lint job; no explicit publish/deploy. Secrets required for Supabase + Stripe even in tests; ensure they exist in PR pipelines.

## 2. Engine Surface Readiness (Endpoints & Tests)
- Upload: `POST /api/upload/init` (plan gate uploads_per_day, usage assertions projects/source_minutes, rate-limit, Supabase insert, signed URL); `POST /api/upload/complete` (plan gate concurrent_jobs, rate-limit, enqueues TRANSCRIBE job). Tests: `upload-init.test.ts` (app router handler), `upload.edge-cases.test.ts` (coverage on payload/env/rate-limit), engine flow integration touches approve path; no direct test seen for `/upload/complete`.
- Clips: `/api/clips/[id]/approve` (plan not enforced; rate-limit; idempotency; enqueues CLIP_RENDER), `/meta` (PATCH metadata), `/reject` (POST set rejected). Tests: `engine.flows.test.ts` exercises approve path; `clips.edge-cases.test.ts` covers approve/reject/meta payload and error states.
- Publish: `/api/publish/tiktok` (plan gate concurrent_jobs, rate-limit, connected account resolution, viral hooks, idempotency for E2E workspace, enqueue PUBLISH_TIKTOK jobs); `/api/publish/youtube` (plan gate concurrent_jobs, rate-limit skipped in tests, resolves accounts, enqueues jobs). Tests: `publish.edge-cases.test.ts` covers missing accounts, already published, not-ready states; engine flows include publish expectations for job inserts.
- Billing surface: `/api/billing/checkout` (Stripe checkout, idempotency helper, requires STRIPE_SECRET_KEY, plan/price validation); `/api/billing/status` (uses usageService summary with plan/usage/trial flags); `/api/billing/usage` (usage-only). Tests: `billing.status.test.ts`, `billing.edge-cases.test.ts` cover status/usage paths; checkout not directly covered here.
- Cron: `/api/cron/scan-schedules` (POST only, guarded by `CRON_SECRET` or `VERCEL_AUTOMATION_BYPASS_SECRET`, calls scanSchedules). Tests: `cron.scan-schedules.test.ts`, `cron.schedules.edge-cases.test.ts` exercise auth/behavior.
- Health/Readiness: `/api/health` (boolean ok from `buildBackendReadinessReport`), `/api/readyz` (detailed checks/queue/ffmpeg shaping, 503 on hard fail), `/api/admin/readyz` (full payload + timestamp). Tests: `health.test.ts`, `readyz.test.ts`, `admin.readyz.test.ts` cover success/failure shapes and status codes.
- Additional surface tests: `jobs.*.test.ts`, `projects.detail.lifecycle.test.ts`, `tiktok-oauth.test.ts`, `audit-logging.test.ts` provide peripheral coverage (jobs lookup, OAuth flow), but not all endpoints (e.g., `/api/upload/complete`) are explicitly exercised.

## 3. Billing, Usage & Onboarding Readiness
- Plan definitions: `packages/shared/src/billing/planMatrix.ts` defines `PLAN_MATRIX` for `basic|pro|premium` with limits (uploads_per_day, clips_per_project, max_team_members, storage_gb, concurrent_jobs, source_minutes_per_month, clips_per_month, projects_per_month, posts_per_month) and feature flags (schedule, ai_titles, ai_captions, watermark_free_exports).
- Plan gating: `planGate.ts` (`checkPlanAccess`, `enforcePlanAccess`) used inline by upload/publish routes; returns plan_required vs plan_limit codes.
- Usage tracking: `usageTracker.ts` (Supabase service-role client) provides `assertWithinUsage`, `recordUsage`, `getUsageSummary`, `checkUsage`; metrics: source_minutes, clips, projects, posts; uses `workspace_usage` table and RPC fallback; throws `UsageLimitExceededError` (429 plan_limit). Upload init invokes usage checks and records projects; publish endpoints currently do not enforce usage beyond plan gates.
- Billing surface wiring:
  - Checkout: `/api/billing/checkout` validates `priceId` against `STRIPE_PLAN_MAP` (prod price IDs mapped to plan), creates Stripe session, optional idempotency via shared helper; requires `STRIPE_SECRET_KEY` env and idempotency header for replay.
  - Status/Usage: `/api/billing/status` and `/api/billing/usage` call `getWorkspaceUsageSummary` (apps/web `usageService.ts`), which pulls workspace `plan`/`billing_status`, `subscriptions.trial_end`, uses `PLAN_MATRIX` for minutes/clips/projects; posts bucket currently placeholder (TODO comments, defaults posts=0 used with static limits map); returns soft/hard limit flags.
  - Webhooks: `/api/webhooks/stripe` handles `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}` via `stripeHandlers.ts`; resolves workspace_id from metadata/subscription/customer, updates subscriptions, logs audit events. Requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Supabase service role.
- Onboarding gaps: plan names and Stripe price IDs are mapped, but posts usage not tracked; publish flows do not consult usageTracker; checkout relies on env presence at runtime; status/usage endpoints assume `workspaces.plan` truth.

## 4. Observability & Health
- Health endpoints: all use `buildBackendReadinessReport` (checks env required/optional, DB tables `workspaces/jobs/schedules/subscriptions`, Stripe price IDs via `STRIPE_PLAN_MAP`, Sentry DSN presence, optional worker status; queue/ffmpeg fields can be populated by engine helpers). `/readyz` normalizes queue metrics and returns 503 on hard fail (queue hardFail or ffmpeg false or env/db/worker false). `/health` returns only `{ok}` (503 on not ok). `/admin/readyz` returns full payload + timestamp.
- CI tie-in: `backend-core` job runs `backend:readyz` and `test:core` (health/readiness-focused) to gate PRs.
- Sentry/logging: Sentry init present in `apps/web/sentry.{client,server,edge}.config.ts` and `packages/shared/src/sentry.ts` (skips init if DSN missing, filters 4xx). Logging via `@cliply/shared/logging/logger` and local `logger` wrappers in routes; audit logging in Stripe webhooks; readiness logs to console.
- Rate limiting: shared rate-limit helper used by upload, clips, publish, billing checkout; limits enforced per user key.

## 5. Relationship to Previous Audit
- The referenced prior report `REPORTS/backend_readiness_audit_integrate_engine_surface_v1.md` is not present in the repo. This audit therefore cannot cross-reference specific prior findings; observations here are based solely on current code state.

## 6. Recommended Epic Ordering for Person 2
- Epic 1 – Integration → main & CI green: keep `backend-core` fast; consider deduping `pnpm test` vs `test:coverage`; verify Supabase/Stripe secrets available in PR CI; add lint job if desired.
- Epic 2 – Surface API & flows smoke-test + docs: add coverage for `/api/upload/complete` and end-to-end upload→transcribe→ready flows; document plan gates and rate limits per endpoint; ensure publish flows document idempotency behavior differences for E2E workspace.
- Epic 3 – CI/CD & deployment: gate deploys on `backend-core`; cache pnpm more aggressively; ensure readiness/health endpoints are hooked into deployment health checks; consider lighter coverage job for PRs and full coverage nightly.
- Epic 4 – Stripe, PLAN_MATRIX & onboarding flow: align `PLAN_MATRIX` with Stripe price IDs (especially posts limits), wire usageTracker into publish/job creation, close TODO in `usageService` for posts; validate checkout/session metadata requirements; add tests for `/api/billing/checkout` and webhook happy paths.
- Epic 5 – Observability & basic ops: ensure Sentry DSN configured in env/CI; add structured logging around queue/ffmpeg readiness inputs; expose queue depth/worker status metrics to dashboards; confirm cron endpoint secrets managed and monitored.
