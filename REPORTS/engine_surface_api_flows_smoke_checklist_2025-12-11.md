# Engine Surface API Flows – Smoke-Test Checklist (2025-12-11)

## 1. How to use this checklist

- **Base URL**: `http://localhost:3000` (replace with deployed URL if needed).
- Include debug headers where indicated (e.g. `x-debug-user`, `x-debug-workspace`).
- Use Thunder Client or Postman to run each call.
- For each endpoint, verify:
  - Status code.
  - Response structure matches expectations.
  - Relevant error codes are used when preconditions fail.

## 2. Common headers & auth

- `Content-Type: application/json` (where applicable).
- Debug headers (test environment only):
  - `x-debug-user: 00000000-0000-0000-0000-000000000001` (example user UUID used in tests)
  - `x-debug-workspace: 11111111-1111-1111-1111-111111111111` (example workspace UUID used in tests)
  - `x-workspace-id: 11111111-1111-1111-1111-111111111111` (required for most endpoints, matches debug workspace)
- Debug headers inject a test user/workspace into the auth context for manual testing without real authentication. Production rejects debug headers.

## 3. Upload API

### 3.1 POST /api/upload/init

- **Method**: `POST`
- **Path**: `/api/upload/init`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body** (discriminated union by `source`):
  - File upload: `{ "source": "file", "filename": "video.mp4", "size": 1024000, "mime": "video/mp4" }`
  - YouTube import: `{ "source": "youtube", "url": "https://youtube.com/watch?v=..." }`
- **Success response** (200):
  - File: `{ "ok": true, "uploadUrl": "https://...", "storagePath": "videos/.../source.mp4", "projectId": "uuid" }`
  - YouTube: `{ "ok": true, "projectId": "uuid" }`
- **Key error cases**:
  - 400 `invalid_request`: invalid payload, unsupported file extension, mime mismatch
  - 429 `plan_limit`/`plan_required`: uploads_per_day limit exceeded or plan insufficient
  - 429 `usage_limit_exceeded`: source_minutes or projects usage exceeded

### 3.2 POST /api/upload/complete

- **Method**: `POST`
- **Path**: `/api/upload/complete`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "projectId": "uuid" }`
- **Success response** (200):
  - `{ "ok": true }` (enqueues TRANSCRIBE job)
- **Key error cases**:
  - 400 `invalid_request`: missing/invalid projectId
  - 403/429 `plan_limit`/`plan_required`: concurrent_jobs limit exceeded

## 4. Clips API

### 4.1 POST /api/clips/[id]/approve

- **Method**: `POST`
- **Path**: `/api/clips/[id]/approve`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "note": "optional approval note" }`
- **Success response** (200):
  - `{ "ok": true, "clipId": "uuid" }` (enqueues CLIP_RENDER job)
- **Key error cases**:
  - 400 `invalid_clip_state`: clip not in approved state
  - 400 `clip_already_published`: clip already published

### 4.2 PATCH /api/clips/[id]/meta

- **Method**: `PATCH`
- **Path**: `/api/clips/[id]/meta`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "title": "New Title", "description": "Description", "hashtags": ["#tag1", "#tag2"] }`
- **Success response** (200):
  - `{ "ok": true }`
- **Key error cases**:
  - 400 `invalid_request`: invalid fields/hashtags

### 4.3 POST /api/clips/[id]/reject

- **Method**: `POST`
- **Path**: `/api/clips/[id]/reject`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "reason": "Rejection reason" }`
- **Success response** (200):
  - `{ "ok": true }`
- **Key error cases**:
  - 400 `invalid_request`: missing/invalid reason

## 5. Publish API

### 5.1 POST /api/publish/tiktok

- **Method**: `POST`
- **Path**: `/api/publish/tiktok`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "clipId": "uuid", "connectedAccountIds": ["account-uuid"], "caption": "Caption text", "privacyLevel": "PUBLIC_TO_EVERYONE" }`
- **Success response** (200):
  - `{ "ok": true, "accountCount": 1, "jobIds": ["job-uuid"] }` (enqueues PUBLISH_TIKTOK job(s))
- **Key error cases**:
  - 400 `missing_connected_account`: no active TikTok accounts
  - 400 `clip_already_published`: clip already published
  - 400 `invalid_clip_state`: clip not in 'ready' state
  - 403/429 `plan_limit`/`plan_required`: concurrent_jobs limit exceeded

### 5.2 POST /api/publish/youtube

- **Method**: `POST`
- **Path**: `/api/publish/youtube`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "clipId": "uuid", "connectedAccountIds": ["account-uuid"], "visibility": "public" }`
- **Success response** (200):
  - `{ "ok": true, "jobIds": ["job-uuid"], "accountCount": 1 }` (enqueues publish job(s))
- **Key error cases**:
  - 400 `missing_connected_account`: no active YouTube accounts
  - 400 `clip_already_published`: clip already published
  - 400 `invalid_clip_state`: clip not in 'ready' state
  - 403/429 `plan_limit`/`plan_required`: concurrent_jobs limit exceeded

## 6. Billing API

### 6.1 GET /api/billing/status

- **Method**: `GET`
- **Path**: `/api/billing/status`
- **Headers**:
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**: None
- **Success response** (200):
  - `{ "ok": true, "plan": { "tier": "basic|pro|premium", "billingStatus": null, "trial": { "active": false, "endsAt": null } }, "usage": { "minutes": { "used": 0, "limit": 150, "remaining": 150, "softLimit": false, "hardLimit": false }, "clips": {...}, "projects": {...}, "posts": {...} }, "softLimit": false, "hardLimit": false }`
- **Key error cases**:
  - 404 `workspace_not_found`: workspace not found

### 6.2 GET /api/billing/usage

- **Method**: `GET`
- **Path**: `/api/billing/usage`
- **Headers**:
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**: None
- **Success response** (200):
  - `{ "ok": true, "minutes": { "used": 0, "limit": 150, "remaining": 150, "softLimit": false, "hardLimit": false }, "clips": {...}, "projects": {...}, "posts": {...} }`
- **Key error cases**:
  - 404 `workspace_not_found`: workspace not found

### 6.3 POST /api/billing/checkout

- **Method**: `POST`
- **Path**: `/api/billing/checkout`
- **Headers**:
  - `Content-Type: application/json`
  - `x-debug-user`, `x-debug-workspace`, `x-workspace-id`
- **Request body**:
  - `{ "priceId": "price_1SPAJQJ2vBRZZMLQFeAuYJK5", "successUrl": "https://...", "cancelUrl": "https://..." }`
- **Success response** (200):
  - `{ "ok": true, "checkoutUrl": "https://checkout.stripe.com/...", "sessionId": "cs_test_..." }`
- **Key error cases**:
  - 400 `invalid_price`: invalid price ID

## 7. Cron / Schedules API

### 7.1 POST /api/cron/scan-schedules

- **Method**: `POST`
- **Path**: `/api/cron/scan-schedules`
- **Headers**:
  - `x-cron-secret: secret-value` or `Authorization: Bearer secret-value`
- **Request body**: None (or `{}` empty)
- **Success response** (200):
  - `{ "ok": true, "scanned": 5, "claimed": 3, "enqueued": 2, "enqueued_tiktok": 1, "enqueued_youtube": 1, "skipped": 1, "failed": 0 }`
- **Key error cases**:
  - 403 `FORBIDDEN`: missing/invalid cron secret

## 8. Health & Readiness

### 8.1 GET /api/health

- **Method**: `GET`
- **Path**: `/api/health`
- **Headers**: None required
- **Request body**: None
- **Success response** (200):
  - `{ "ok": true }`
- **Error response** (503):
  - `{ "ok": false }`

### 8.2 GET /api/readyz

- **Method**: `GET`
- **Path**: `/api/readyz`
- **Headers**: None required
- **Request body**: None
- **Success response** (200):
  - `{ "ok": true, "checks": { "env": {...}, "db": {...}, "worker": {...} }, "queue": { "length": 0, "oldestJobAge": null }, "ffmpeg": { "ok": true } }`
- **Error response** (503):
  - `{ "ok": false, ... }` (with failing check details)

### 8.3 GET /api/admin/readyz

- **Method**: `GET`
- **Path**: `/api/admin/readyz`
- **Headers**: None required
- **Request body**: None
- **Success response** (200):
  - `{ "ok": true, "checks": {...}, "queue": {...}, "ffmpeg": {...}, "timestamp": "2025-12-11T..." }`
- **Error response** (503):
  - `{ "ok": false, ... }`

## 9. Error codes and semantics

- `usage_limit_exceeded` (429): Usage quota exceeded (minutes, clips, projects, posts)
- `posting_limit_exceeded` (429): Posting rate limit exceeded
- `missing_connected_account` (400): No connected accounts found for platform
- `invalid_connected_account` (400): Invalid account configuration
- `invalid_clip_state` (400): Clip in wrong state for operation
- `video_too_long_for_plan` (400): Video exceeds plan limits
- `video_too_short` (400): Video too short for processing
- `workspace_not_configured` (400): Workspace missing required configuration
- `clip_already_published` (400): Clip already published
- `plan_insufficient` (403): Plan does not support requested feature

## 10. Suggested manual smoke-test sequence

1. **Health checks**: Hit `/api/health`, `/api/readyz`, `/api/admin/readyz` to verify system status
2. **Upload flow**: POST to `/api/upload/init` (file source), then POST to `/api/upload/complete` (verify project created)
3. **Clip management**: PATCH `/api/clips/[id]/meta` to update clip metadata, then POST `/api/clips/[id]/approve` to approve (verify job enqueued)
4. **Billing checks**: GET `/api/billing/status` and `/api/billing/usage` to verify plan/usage data
5. **Publish attempts**: POST to `/api/publish/tiktok` and `/api/publish/youtube` (expect account errors if no accounts connected)
6. **Cron trigger**: POST to `/api/cron/scan-schedules` with proper auth (verify job scanning works)

---

**Results Log**

See `REPORTS/engine_surface_api_flows_smoke_results_2025-12-11.md` for actual manual smoke-test outcomes.