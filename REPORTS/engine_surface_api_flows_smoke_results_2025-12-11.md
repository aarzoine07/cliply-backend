# Engine Surface API Flows – Manual Smoke-Test Results (2025-12-11)

## 1. How to run this smoke test

- Start backend locally (see commands below).
- Use Thunder Client or Postman pointing to `http://localhost:3000`.
- For debug-auth endpoints, include:
  - `x-debug-user: 00000000-0000-0000-0000-000000000001`
  - `x-debug-workspace: 11111111-1111-1111-1111-111111111111`
  - `x-workspace-id: 11111111-1111-1111-1111-111111111111`
- For each endpoint:
  - Run the "happy path" request.
  - Optionally run 1–2 key error scenarios (e.g. missing account, invalid clip state).
  - Record actual status code, short notes, and any deviations from the checklist.

## 2. Summary

- Overall status: SOME ISSUES – core health endpoint is OK, but most engine surface APIs are currently returning 404 on this branch.
- Notes:
  - /api/health responds 200 with `{ "ok": true, "message": "Cliply backend healthy" }`.
  - /api/readyz and /api/admin/readyz both return 404 (readiness/admin readiness routes not wired in this branch).
  - Upload endpoints `/api/upload/init` and `/api/upload/complete` return a Next.js 404 HTML page instead of JSON API responses – routes are missing or mounted differently.
  - Billing endpoints `/api/billing/status`, `/api/billing/usage`, and `/api/billing/checkout` also return Next.js 404 HTML pages – billing surface is not yet exposed on this branch.
  - Clip, publish, and cron endpoints are not fully exercised yet in this pass; they will be verified once the core upload/billing surfaces are wired in later epics.

## 3. Endpoint-by-endpoint results

### 3.1 Upload

#### 3.1.1 POST /api/upload/init

- Request example used:

```json
{
  "source": "file",
  "filename": "video.mp4",
  "size": 1024000,
  "mime": "video/mp4"
}
```

- Expected: 200, { "ok": true, "uploadUrl": "...", "storagePath": "...", "projectId": "..." }
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)
- Notes (errors, differences from checklist): Endpoint not found at /api/upload/init. Expected JSON API response. Likely path/basePath mismatch or route not implemented yet – to be fixed in later epic.

#### 3.1.2 POST /api/upload/complete

- Request example used:

```json
{ "projectId": "TODO-project-id-from-init" }
```

- Expected: 200, { "ok": true }
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/upload/complete. Expected JSON API JSON response. Likely same routing/implementation gap as /api/upload/init – to be fixed in a later epic.

### 3.2 Clips

#### 3.2.1 POST /api/clips/[id]/approve

#### 3.2.1 POST /api/clips/[id]/approve

- Clip ID used: `00000000-0000-0000-0000-000000000000`
- Expected: 200, { "ok": true, "clipId": "..." } (enqueues CLIP_RENDER job)
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/clips/[id]/approve. Expected JSON API handler. Likely route is missing or lives under a different router/path in this branch – to be implemented/realigned in a later epic.

#### 3.2.2 PATCH /api/clips/[id]/meta

#### 3.2.2 PATCH /api/clips/[id]/meta

- Clip ID used: 00000000-0000-0000-0000-000000000000
- Expected: 200, { "ok": true }
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/clips/[id]/meta for this branch. Expected JSON API handler for clip metadata updates. Likely route missing or path changed – to be implemented/realigned in a later epic.

#### 3.2.3 POST /api/clips/[id]/reject

#### 3.2.3 POST /api/clips/[id]/reject

- Clip ID used: `00000000-0000-0000-0000-000000000000`
- Expected: 200, { "ok": true }
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/clips/[id]/reject. Expected JSON API handler. Likely route is missing or lives under a different router/path in this branch – to be implemented/realigned in a later epic.

### 3.3 Publish

#### 3.3.1 POST /api/publish/tiktok

#### 3.3.1 POST /api/publish/tiktok

- Clip ID used: `00000000-0000-0000-0000-000000000000`
- Expected:
  - 200 with jobs enqueued, or
  - 400 `missing_connected_account` if no TikTok accounts connected.
- Actual status: 404
- Actual response snippet: HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at `/api/publish/tiktok`. Expected JSON API handler enforcing plan usage + anti-spam and enqueueing publish jobs. Likely route is missing or lives under a different path/router in this branch – to be implemented/realigned in a later epic.

#### 3.3.2 POST /api/publish/youtube

#### 3.3.2 POST /api/publish/youtube

- Clip ID used: `00000000-0000-0000-0000-000000000000`
- Expected:
  - 200 with jobs enqueued, or
  - 400 `missing_connected_account` if no YouTube accounts connected.
- Actual status: 404
- Actual response snippet: HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at `/api/publish/youtube`. Expected JSON API handler enforcing plan usage + anti-spam and enqueueing publish jobs. Likely route is missing or lives under a different path/router in this branch – to be implemented/realigned in a later epic.

### 3.4 Billing

#### 3.4.1 GET /api/billing/status

- Expected: 200, plan + usage summary.
- Actual status: 404
- Actual response snippet: HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/billing/status. Expected JSON API response but route is missing or not wired on this branch. Needs to be implemented or path corrected in a later epic.

#### 3.4.2 GET /api/billing/usage

#### 3.4.2 GET /api/billing/usage

- Expected: 200, usage counters.
- Actual status: 404
- Actual response snippet: HTML Next.js 404 page (“This page could not be found.”)
- Notes: Endpoint not found at /api/billing/usage. Expected JSON API response per checklist – likely route name/basePath mismatch or not wired in this branch yet. To be fixed in a later epic.

#### 3.4.3 POST /api/billing/checkout

- Request example used:

```json
{
  "priceId": "price_1SPAJQJ2vBRZZMLQFeAuYJK5",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel"
}
```

- Expected: 200, { "ok": true, "checkoutUrl": "...", "sessionId": "..." }
	•	Actual status: 404
	•	Actual response snippet: HTML Next.js 404 page (“This page could not be found.”)
	•	Notes (e.g. Stripe test mode behavior): Endpoint not found at /api/billing/checkout. Expected JSON API response with Stripe checkout URL. Likely route missing or path changed in this branch – to be implemented/realigned in a later epic.

### 3.5 Cron / Schedules

#### 3.5.1 POST /api/cron/scan-schedules

#### 3.5.1 POST /api/cron/scan-schedules

- Headers: `x-cron-secret: test-secret`
- Expected: 200, aggregate counts for scanned/enqueued jobs.
- Actual status: 500
- Actual response snippet: HTML error page wrapping an API error – message shows:  
  `Environment variable validation failed: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are undefined. Please check your .env file or environment configuration.`
- Notes: Endpoint exists at `/api/cron/scan-schedules` and runs through the API handler, but fails early on env validation because required Supabase environment variables are not set in the current dev environment. This is an environment/configuration issue, not a routing problem; to be fixed when we wire proper SUPABASE_* values for local/dev in a later epic.

### 3.6 Health & Readiness

#### 3.6.1 GET /api/health

- Expected: 200 { "ok": true } when healthy.
- Actual status: 200
- Actual response (short snippet): {"ok":true,"message":"Cliply backend healthy"}

#### 3.6.2 GET /api/readyz

- Expected: 200 with checks summary.
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)

#### 3.6.3 GET /api/admin/readyz

- Expected: 200 with detailed readiness info.
- Actual status: 404
- Actual response (short snippet): HTML Next.js 404 page (“This page could not be found.”)

## 4. Discovered issues / follow-ups

- `/api/upload/init`: returns Next.js 404 HTML page instead of JSON API response. Endpoint not wired on this branch; needs proper handler added under `/pages/api/upload/init.ts`.
- `/api/billing/status`: returns Next.js 404 HTML page instead of billing status JSON. Billing status route missing or mis-routed; must be implemented and aligned with PLAN_MATRIX and usage in a later epic.

- [ ] **/api/upload/init returns 404**
  - Endpoint: POST /api/upload/init
  - Request used: file upload payload with debug headers (see section 3.1.1)
  - Actual vs expected: Returns Next.js 404 HTML instead of JSON upload-init response.
  - Suggested follow-up: Wire upload-init handler at /pages/api/upload/init.ts (or correct path) and ensure it matches the documented request/response shape.

- [ ] **/api/readyz and /api/admin/readyz return 404**
  - Endpoint: GET /api/readyz, GET /api/admin/readyz
  - Actual vs expected: Both return Next.js 404 HTML instead of readiness JSON.
  - Suggested follow-up: Restore /pages/api/readyz.ts and /pages/api/admin/readyz.ts (or equivalent) and align with readiness model.