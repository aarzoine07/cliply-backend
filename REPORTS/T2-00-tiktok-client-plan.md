# T2-00 — TikTok Publish Track Discovery & Implementation Plan

**Status:** Planning (Documentation Only)  
**Track:** T2 — TikTok Publishing Client Standardization  
**Created:** 2025-01-XX  
**Purpose:** Detailed implementation plan for standardizing and enhancing the TikTok Content Posting client to match YouTube client architecture patterns

---

## 1. Current State Snapshot

### 1.1 TikTok OAuth & Tokens

**Files:**
- `apps/web/src/app/api/auth/tiktok/connect/route.ts` — Initiates TikTok OAuth flow
- `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts` — Handles OAuth callback
- `packages/shared/src/services/tiktokAuth.ts` — Token management utilities

**How we currently initiate TikTok OAuth:**
- Route: `GET /api/auth/tiktok/connect?workspace_id=<uuid>`
- Builds PKCE-compliant authorization URL with:
  - `client_key`: From `TIKTOK_CLIENT_ID` env var
  - `scope`: `"user.info.basic,video.upload"` (comma-separated)
  - `redirect_uri`: From `NEXT_PUBLIC_TIKTOK_REDIRECT_URL`
  - `code_challenge` and `code_challenge_method`: PKCE S256
  - `state`: Base64url-encoded JSON with `{ workspace_id, user_id, code_verifier }`
- Redirects user to: `https://www.tiktok.com/v2/auth/authorize/`

**How we handle callbacks:**
- Route: `GET /api/auth/tiktok/connect/callback?code=<code>&state=<state>`
- Decodes state to extract `workspace_id`, `user_id`, `code_verifier`
- Exchanges authorization code for tokens via `POST https://open-api.tiktok.com/v2/oauth/token/`
- Fetches user info via `GET https://open.tiktokapis.com/v2/user/info/` to get `open_id`
- Stores tokens in `connected_accounts` table

**How we store TikTok tokens in Supabase (`connected_accounts`):**
- **Fields used:**
  - `provider`: `"tiktok"`
  - `platform`: `"tiktok"`
  - `external_id`: TikTok `open_id` (from user info API)
  - `access_token_encrypted_ref`: JSON envelope `{ v: 1, purpose: "tiktok_token", secret: "<encrypted>" }`
  - `refresh_token_encrypted_ref`: Same envelope format (nullable)
  - `expires_at`: ISO timestamp (calculated from `expires_in` in token response)
  - `scopes`: Array of strings (e.g., `["user.info.basic", "video.upload"]`)
  - `status`: `"active"` (implicit — presence of row means active)
  - `workspace_id`: UUID of the workspace
  - `user_id`: UUID of the user who connected the account

**Encryption/decryption logic:**
- Uses JSON envelope format: `{ v: number, purpose: string, secret: string }`
- Purpose: `"tiktok_token"` for both access and refresh tokens
- Encryption handled by `encryptSecret()` / `decryptSecret()` from `@cliply/shared/crypto/encryptedSecretEnvelope`
- Same pattern as YouTube (though YouTube uses different purpose strings)

**Token refresh:**
- Job: `apps/worker/src/jobs/refreshTikTokTokens.ts` — Background job that refreshes expiring tokens
- Service function: `getFreshTikTokAccessToken(connectedAccountId, ctx)` in `packages/shared/src/services/tiktokAuth.ts`
  - Checks if token expires within 5 minutes
  - If expired/expiring: calls `refreshTikTokAccessToken()` and updates DB
  - Returns plaintext access token ready for API calls
  - Mirrors `getFreshYouTubeAccessToken` pattern exactly

### 1.2 TikTok Client & Pipelines

**TikTok Client:**
- **Path:** `apps/worker/src/services/tiktok/client.ts`
- **Current API:**
  - `class TikTokClient`
    - Constructor: `constructor(config: { accessToken: string })`
    - Method: `async uploadVideo(params: UploadVideoParams): Promise<UploadVideoResult>`
  - `interface UploadVideoParams`
    - `filePath: string`
    - `caption?: string`
    - `privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIEND' | 'SELF_ONLY'`
  - `interface UploadVideoResult`
    - `videoId: string`
    - `rawResponse: unknown`
  - `class TikTokApiError extends Error`
    - Properties: `status`, `tiktokErrorCode`, `tiktokErrorMessage`, `retryable`

**Current implementation status:**
- ✅ **Real implementation exists** — Not a stub
- ✅ Implements three-step TikTok Content Posting API flow:
  1. `initUpload()` — POST to `/v2/post/publish/inbox/video/init/` to get `upload_url` and `publish_id`
  2. `uploadFile()` — PUT video file to `upload_url`
  3. `publishVideo()` — POST to `/v2/post/publish/` with `publish_id` to finalize
- ✅ Error handling via `TikTokApiError` class
- ✅ Retry logic indicators (`retryable` flag)
- ⚠️ **Missing:** Type system matching YouTube pattern (no `TikTokUploadResult` discriminated union)
- ⚠️ **Missing:** Env-gated stub mode (`TIKTOK_UPLOAD_MODE`)
- ⚠️ **Missing:** Structured error code union (uses ad-hoc error handling)

**Pipelines:**
- **Path:** `apps/worker/src/pipelines/publish-tiktok.ts`
- **How it calls the TikTok client:**
  1. Fetches clip from DB (`clips` table)
  2. Downloads clip from storage to temp file
  3. Gets fresh access token via `getFreshTikTokAccessToken(payload.connectedAccountId, { supabase: ctx.supabase })`
  4. Instantiates `TikTokClient` with access token
  5. Calls `tiktok.uploadVideo()` with:
     - `filePath`: temporary downloaded file path
     - `caption`: from payload or `clip.caption_suggestion` or empty string
     - `privacyLevel`: from payload or defaults to `"PUBLIC_TO_EVERYONE"`
  6. Expects back: `{ videoId: string, rawResponse: unknown }`
- **Post-upload actions:**
  - Updates `clips` table: sets `status = 'published'`, `external_id = response.videoId`, `published_at = now()`
  - Updates `variant_posts` table if experimentId/variantId present
  - Records usage via `recordUsage()` for billing
  - Advances project `pipeline_stage` to `'PUBLISHED'`
  - Enforces posting limits (anti-spam guard)
  - Checks workspace-level posts usage limits

**Existing tests:**
- **Path:** `apps/worker/test/publish-tiktok.pipeline.test.ts`
- Tests pipeline integration with mocked TikTok client
- No unit tests for TikTok client itself yet

**Existing reports:**
- No dedicated TikTok client implementation plan exists (this document is the first)

### 1.3 Token & Auth Context

**How we obtain TikTok access tokens at publish time:**
- Function: `getFreshTikTokAccessToken(accountId: string, ctx: { supabase: SupabaseClient }): Promise<string>`
- Location: `packages/shared/src/services/tiktokAuth.ts` (lines 232-291)
- Behavior:
  - Fetches `connected_accounts` row where `platform = 'tiktok'` and `id = accountId`
  - Checks if token expires within 5 minutes
  - If expired/expiring: refreshes using `refresh_token_encrypted_ref`
  - Returns plaintext access token (ready for `Authorization: Bearer` header)
  - Handles encryption/decryption of stored tokens
- **Analogy to `getFreshYouTubeAccessToken`:**
  - ✅ Same pattern — both check expiry, refresh if needed, return plaintext token
  - ✅ Both use same encryption/decryption utilities
  - ✅ Both update DB with refreshed tokens

**Constraints / TODOs:**
- ✅ Token refresh is already handled — client doesn't need to handle it
- ✅ Access tokens are returned as plaintext strings (ready for API calls)
- ✅ No additional encryption needed in client — tokens are already decrypted
- ⚠️ **Missing:** Env flag to gate stub vs real mode (like `YOUTUBE_UPLOAD_MODE`)
- ⚠️ **Missing:** Type system matching YouTube's discriminated union pattern

---

## 2. Target Behaviour & TikTok API Surface

### 2.1 Core Operations for MVP

**MVP Operation: `uploadVideo` (required)**

**Inputs:**
- `videoPath: string` — Local file path to MP4 video file
- `caption?: string` — Video caption (max 2200 characters per TikTok docs)
- `hashtags?: string[]` — Array of hashtag strings (extracted from caption or provided separately)
- `visibility?: TikTokPrivacyLevel` — Privacy setting (`'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIEND' | 'SELF_ONLY'`)
- `workspaceId: string` — For logging/telemetry
- `connectedAccountId: string` — For token retrieval (if we move token fetch into client)

**Outputs:**
- `{ postId: string }` — TikTok video/post identifier (e.g., `"7234567890123456789"`)
- Future enhancement: could include `publishedAt`, `status`, etc., but MVP only needs `postId`

**TikTok Content Posting API Flow:**
TikTok uses a **three-step upload flow**:
1. **Initialize upload** → POST to `https://open.tiktokapis.com/v2/post/publish/inbox/video/init/`
   - Returns `upload_url` (temporary signed URL) and `publish_id`
2. **Upload video file** → PUT video file to `upload_url` (direct upload to TikTok's storage)
3. **Publish video** → POST to `https://open.tiktokapis.com/v2/post/publish/` with `publish_id` and final metadata

**Current implementation:** ✅ Already implements this flow correctly

**Future operations (out of scope for MVP):**
- `schedulePost` — TikTok Content Posting API does not support scheduling (must use external scheduling)
- `updatePost` — TikTok API does not support editing posts after publish
- `deletePost` — Would require TikTok Management API (different scope)

### 2.2 TikTok Content Posting API Endpoints

**Operation: `uploadVideo`**

**Step 1 — Initialize Upload:**

**Endpoint:** `POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/`

**HTTP Method:** POST

**Headers:**
- `Authorization: Bearer {accessToken}`
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "post_info": {
    "title": "{caption}",
    "privacy_level": "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIEND" | "SELF_ONLY",
    "disable_duet": false,
    "disable_comment": false,
    "disable_stitch": false,
    "video_cover_timestamp_ms": 1000
  },
  "source_info": {
    "source": "FILE_UPLOAD"
  }
}
```

**Response:**
- Status: `200 OK`
- Body (JSON):
  ```json
  {
    "data": {
      "upload_url": "https://...",
      "publish_id": "abc123..."
    }
  }
  ```
- Error responses:
  - `400 Bad Request`: Invalid metadata (caption too long, invalid privacy level, etc.)
  - `401 Unauthorized`: Invalid/expired token
  - `403 Forbidden`: Insufficient scope or account restrictions
  - `429 Too Many Requests`: Rate limit exceeded
  - `500+`: TikTok server errors

**Step 2 — Upload Video File:**

**Endpoint:** `PUT {upload_url}` (from Step 1 response)

**HTTP Method:** PUT

**Headers:**
- `Content-Type: video/mp4`
- `Content-Length: {fileSizeInBytes}`

**Body:** Raw video file bytes (from `readFile(filePath)`)

**Response:**
- Status: `200 OK` (or `204 No Content`)
- Body: Empty or minimal

**Step 3 — Publish Video:**

**Endpoint:** `POST https://open.tiktokapis.com/v2/post/publish/`

**HTTP Method:** POST

**Headers:**
- `Authorization: Bearer {accessToken}`
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "publish_id": "{publish_id from Step 1}",
  "post_info": {
    "title": "{caption}",
    "privacy_level": "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIEND" | "SELF_ONLY",
    "disable_duet": false,
    "disable_comment": false,
    "disable_stitch": false,
    "video_cover_timestamp_ms": 1000
  }
}
```

**Response:**
- Status: `200 OK`
- Body (JSON):
  ```json
  {
    "data": {
      "publish_id": "abc123...",
      "upload_url": "...",
      "video_id": "7234567890123456789"  // ← This is the postId we need
    }
  }
  ```
- Error responses: Same as Step 1

**Required OAuth Scopes:**
- `video.upload` — ✅ Already requested in OAuth flow (line 48 in `connect/route.ts`, line 186 in callback)
- `user.info.basic` — ✅ Already requested (for fetching user info during OAuth)

**Request/Response shapes (key fields we care about):**

**Initialize request:**
- `post_info.title`: string (max 2200 characters per TikTok docs)
- `post_info.privacy_level`: `"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIEND" | "SELF_ONLY"`
- `post_info.disable_duet`: boolean (default: false)
- `post_info.disable_comment`: boolean (default: false)
- `post_info.disable_stitch`: boolean (default: false)
- `post_info.video_cover_timestamp_ms`: number (milliseconds into video for cover frame)

**Publish response:**
- `data.video_id`: string (TikTok video/post ID)

**Error responses (common):**
- `400 Bad Request`: Invalid metadata (caption too long, invalid privacy level, etc.)
- `401 Unauthorized`: Invalid/expired token (shouldn't happen if `getFreshTikTokAccessToken` works)
- `403 Forbidden`: Insufficient scope, account restrictions, or content moderation rejection
- `429 Too Many Requests`: Rate limit exceeded (retryable with backoff)
- `500+`: TikTok server errors (retryable)

**Video constraints (from TikTok docs):**
- **Format:** MP4 (H.264 video, AAC audio)
- **Duration:** 3 seconds to 10 minutes
- **File size:** Max 287MB (for videos under 10 minutes)
- **Aspect ratio:** 9:16 (vertical) recommended, but supports other ratios
- **Resolution:** Min 540x960, max 1080x1920 (for best quality)

---

## 3. Env Vars, Config, and Scopes

### 3.1 Required Env Vars

**Existing env vars (already in use):**
- `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET`
  - **Purpose:** TikTok OAuth client credentials
  - **Modules:** Web (OAuth flow), Worker (token refresh)
  - **Required for:** Development, Tests, Production
  - **Current usage:** ✅ Already configured and used

- `NEXT_PUBLIC_TIKTOK_REDIRECT_URL`
  - **Purpose:** OAuth redirect URI (public, used in browser)
  - **Modules:** Web
  - **Required for:** Development, Tests, Production
  - **Current usage:** ✅ Already configured and used

**Proposed new env vars (for standardization):**

- `TIKTOK_UPLOAD_MODE` (`"stub" | "real"`)
  - **Purpose:** Gate between stub and real TikTok API calls (analogous to `YOUTUBE_UPLOAD_MODE`)
  - **Modules:** Worker (TikTok client)
  - **Required for:** Development (default: `"stub"`), Tests (default: `"stub"`), Production (must be `"real"`)
  - **Default:** `"stub"` (to prevent accidental real API calls in dev)
  - **Note:** Current implementation always uses real API — this env var will add stub mode for testing

- `TIKTOK_API_BASE_URL` (optional)
  - **Purpose:** Base URL for TikTok API (for testing with mock servers or different environments)
  - **Modules:** Worker (TikTok client)
  - **Required for:** Tests (if using mock server), Development (optional, defaults to `"https://open.tiktokapis.com"`), Production (optional, defaults to `"https://open.tiktokapis.com"`)
  - **Default:** `"https://open.tiktokapis.com"` (hard-coded in client if not provided)

- `TIKTOK_ENABLE_SCHEDULING` (optional, future)
  - **Purpose:** Feature flag for TikTok scheduling (if TikTok adds scheduling API in future)
  - **Modules:** Worker
  - **Required for:** Future feature (not needed for MVP)
  - **Default:** `false` or undefined

**Env var summary:**

| Env Var | Purpose | Module | Dev | Test | Prod | Status |
|---------|---------|--------|-----|------|------|--------|
| `TIKTOK_CLIENT_ID` | OAuth client key | Web, Worker | ✅ | ✅ | ✅ | ✅ Existing |
| `TIKTOK_CLIENT_SECRET` | OAuth client secret | Web, Worker | ✅ | ✅ | ✅ | ✅ Existing |
| `NEXT_PUBLIC_TIKTOK_REDIRECT_URL` | OAuth redirect URI | Web | ✅ | ✅ | ✅ | ✅ Existing |
| `TIKTOK_UPLOAD_MODE` | Stub vs real mode | Worker | ⚠️ New | ⚠️ New | ⚠️ New | ⚠️ To add |
| `TIKTOK_API_BASE_URL` | API base URL (optional) | Worker | ⚠️ New | ⚠️ New | ⚠️ New | ⚠️ Optional |

### 3.2 OAuth Scopes & Permissions

**Current scopes requested:**
- `user.info.basic` — For fetching user info during OAuth flow
- `video.upload` — For uploading videos to TikTok

**Required scopes for Content Posting API:**
- ✅ `video.upload` — Already requested (sufficient for upload + publish flow)
- ✅ `user.info.basic` — Already requested (for user info, not strictly needed for posting but useful)

**Impact on OAuth flow:**
- ✅ **No changes needed** — Current scopes are sufficient
- ✅ Scopes are already included in OAuth authorization URL (line 48 in `connect/route.ts`: `["user.info.basic", "video.upload"]`)

**Backwards compatibility:**
- ✅ All existing connected accounts already have `video.upload` scope (from initial OAuth flow)
- ✅ No need to prompt users to reauthorize

**Future scopes (if needed):**
- `video.list` — For listing user's videos (not needed for MVP)
- `video.data` — For analytics (not needed for MVP)

---

## 4. Error Handling, Retries, and Logging

### 4.1 Expected Failure Modes

**TikTok-specific failure scenarios:**

1. **Invalid/expired access token**
   - HTTP status: `401 Unauthorized`
   - TikTok error code: `"invalid_access_token"` or similar
   - Cause: Token expired or revoked
   - Retryable: ❌ No (must refresh token first)

2. **Insufficient permissions / missing scope**
   - HTTP status: `403 Forbidden`
   - TikTok error code: `"insufficient_scope"` or `"permission_denied"`
   - Cause: Account doesn't have `video.upload` scope, or account restrictions
   - Retryable: ❌ No (user must reauthorize)

3. **Quota or rate limit exceeded**
   - HTTP status: `429 Too Many Requests`
   - TikTok error code: `"rate_limit_exceeded"` or similar
   - Cause: Too many API requests in time window
   - Retryable: ✅ Yes (with exponential backoff)

4. **Invalid video (format, duration, filesize)**
   - HTTP status: `400 Bad Request`
   - TikTok error code: `"invalid_video_format"`, `"video_too_long"`, `"file_too_large"`, etc.
   - Cause: Video doesn't meet TikTok requirements
   - Retryable: ❌ No (must fix video first)

5. **Invalid caption or content moderation issues**
   - HTTP status: `400 Bad Request` or `403 Forbidden`
   - TikTok error code: `"invalid_caption"`, `"content_violation"`, `"moderation_rejected"`, etc.
   - Cause: Caption too long, contains banned words, or violates community guidelines
   - Retryable: ❌ No (must fix caption/content)

6. **Transient network/5xx server errors**
   - HTTP status: `500`, `502`, `503`, `504`
   - TikTok error code: Varies
   - Cause: TikTok API server issues, network timeouts
   - Retryable: ✅ Yes (with exponential backoff)

7. **Upload URL expired**
   - HTTP status: `400 Bad Request` or `410 Gone`
   - TikTok error code: `"upload_url_expired"` or similar
   - Cause: `upload_url` from Step 1 expired before Step 2 completed
   - Retryable: ✅ Yes (restart from Step 1)

8. **Publish ID not found**
   - HTTP status: `404 Not Found`
   - TikTok error code: `"publish_id_not_found"` or similar
   - Cause: `publish_id` from Step 1 invalid or expired before Step 3
   - Retryable: ✅ Yes (restart from Step 1)

### 4.2 Mapping to Our Domain

**TikTok client error code union (proposed):**

```typescript
export type TikTokClientErrorCode =
  | "INVALID_TOKEN"           // 401 - Token expired/invalid
  | "INSUFFICIENT_SCOPE"      // 403 - Missing video.upload scope
  | "FORBIDDEN"               // 403 - Account restrictions, content moderation
  | "RATE_LIMITED"             // 429 - Rate limit exceeded
  | "BAD_REQUEST"              // 400 - Invalid video, caption, metadata
  | "UPLOAD_URL_EXPIRED"       // 400/410 - Upload URL from init expired
  | "PUBLISH_ID_NOT_FOUND"     // 404 - Publish ID invalid/expired
  | "TIKTOK_5XX"               // 500+ - Server errors
  | "TRANSIENT_NETWORK"        // Network timeouts, connection errors
  | "TIMEOUT"                  // Request timeout
  | "UNKNOWN";                 // Unknown/unexpected errors
```

**How these map to job state transitions:**

- **Fatal failures (no retry):**
  - `INVALID_TOKEN` → Job fails, user must reconnect account
  - `INSUFFICIENT_SCOPE` → Job fails, user must reauthorize with correct scopes
  - `FORBIDDEN` (content moderation) → Job fails, user must fix content
  - `BAD_REQUEST` (invalid video/caption) → Job fails, user must fix input

- **Retryable failures:**
  - `RATE_LIMITED` → Job retries with exponential backoff (worker queue handles this)
  - `TIKTOK_5XX` → Job retries with exponential backoff
  - `TRANSIENT_NETWORK` → Job retries with exponential backoff
  - `TIMEOUT` → Job retries with exponential backoff
  - `UPLOAD_URL_EXPIRED` → Job retries (restarts from Step 1)
  - `PUBLISH_ID_NOT_FOUND` → Job retries (restarts from Step 1)

- **Unknown errors:**
  - `UNKNOWN` → Default to retryable (conservative approach)

**Retry vs. fatal failure decisions:**

- **Retryable:** Transient errors (5xx, network, timeouts, rate limits, expired upload URLs)
- **Fatal:** Auth errors (401, 403 scope), invalid input (400 bad video/caption), content moderation (403 forbidden)

### 4.3 Retry Strategy

**When to retry:**
- Network errors (connection refused, timeouts, DNS failures)
- 5xx server errors (500, 502, 503, 504)
- 429 rate limit errors (with backoff)
- Upload URL expired (410 Gone) — restart from Step 1
- Publish ID not found (404) — restart from Step 1

**Retry limits and backoff policy:**
- **Where they live:** Worker queue system (not in client)
- **Current worker retry policy:** Exponential backoff `2^(attempts-1) * 10 seconds`, max 1800s, max attempts configurable
- **Client responsibility:** Return structured error with `isRetryable: boolean` flag
- **Pipeline responsibility:** Re-throw retryable errors so worker can retry

**Idempotency:**
- **Current approach:** Pipeline checks `variant_posts` table for existing post before uploading
- **TikTok API:** Does not provide idempotency keys
- **Best practice:** Check `variant_posts.platform_post_id` before uploading (already implemented in pipeline)
- **Edge case:** If upload succeeds but publish fails, we may have a video in TikTok's inbox but not published — need to handle this in retry logic (check publish status before retrying)

### 4.4 Logging & Telemetry

**What structured logs to emit:**

**On success:**
```typescript
ctx.logger.info("tiktok_upload_success", {
  pipeline: "PUBLISH_TIKTOK",
  workspaceId: string,
  connectedAccountId: string,
  clipId: string,
  postId: string,  // TikTok video_id
  durationMs: number,
});
```

**On retries:**
```typescript
ctx.logger.warn("tiktok_upload_retry", {
  pipeline: "PUBLISH_TIKTOK",
  workspaceId: string,
  connectedAccountId: string,
  clipId: string,
  attempt: number,
  errorCode: TikTokClientErrorCode,
  isRetryable: boolean,
});
```

**On failures:**
```typescript
ctx.logger.error("tiktok_upload_failed", {
  pipeline: "PUBLISH_TIKTOK",
  workspaceId: string,
  connectedAccountId: string,
  clipId: string,
  errorCode: TikTokClientErrorCode,
  httpStatus?: number,
  tiktokErrorCode?: string,
  tiktokErrorMessage?: string,
  isRetryable: boolean,
  // DO NOT log: access tokens, full error response bodies
});
```

**Integration with existing worker logging patterns:**
- ✅ Uses `ctx.logger` from `WorkerContext`
- ✅ Structured JSON logs with consistent field names
- ✅ Sentry integration via `ctx.sentry.captureException()` for errors
- ⚠️ **Security:** Ensure we never log:
  - Access tokens (already handled — tokens are not in logs)
  - Full TikTok error response bodies (may contain sensitive data)
  - Video file contents

---

## 5. TikTok Client API Shape (Type-Level Design)

### 5.1 Public Types

**Planned TypeScript types/signatures (in prose, no actual code):**

**`TikTokPrivacyLevel`:**
- Type: `"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIEND" | "SELF_ONLY"`
- Purpose: Maps to TikTok API `privacy_level` field

**`TikTokUploadParams`:**
- Fields:
  - `workspaceId: string` — For logging/telemetry
  - `connectedAccountId: string` — For token retrieval (if we move token fetch into client)
  - `videoPath: string` — Absolute file path to MP4 video file
  - `caption?: string` — Video caption (max 2200 characters)
  - `hashtags?: string[]` — Array of hashtag strings (extracted from caption or provided separately)
  - `privacyLevel?: TikTokPrivacyLevel` — Privacy setting (defaults to `"PUBLIC_TO_EVERYONE"`)
  - `disableDuet?: boolean` — Whether to disable duet (defaults to `false`)
  - `disableComment?: boolean` — Whether to disable comments (defaults to `false`)
  - `disableStitch?: boolean` — Whether to disable stitch (defaults to `false`)
  - `videoCoverTimestampMs?: number` — Milliseconds into video for cover frame (defaults to `1000`)

**`TikTokClientErrorCode`:**
- Type: Union of error codes (see Section 4.2)

**`TikTokClientErrorDetails`:**
- Fields:
  - `code: TikTokClientErrorCode` — Error code categorizing the failure type
  - `message: string` — Human-readable error message
  - `httpStatus?: number` — HTTP status code from TikTok API (if applicable)
  - `tiktokErrorCode?: string` — TikTok API error code (if available from API response)
  - `tiktokErrorMessage?: string` — TikTok API error message (if available)
  - `isRetryable?: boolean` — Whether this error is retryable (transient failures)

**`TikTokUploadSuccessResult`:**
- Fields:
  - `ok: true` — Discriminator flag indicating success
  - `postId: string` — TikTok video/post ID (e.g., `"7234567890123456789"`)
  - `publishedAt?: string | null` — ISO timestamp of when the video was published (if available)

**`TikTokUploadErrorResult`:**
- Fields:
  - `ok: false` — Discriminator flag indicating failure
  - `error: TikTokClientErrorDetails` — Detailed error information

**`TikTokUploadResult`:**
- Type: Discriminated union `TikTokUploadSuccessResult | TikTokUploadErrorResult`

### 5.2 Client Interface

**Describe the client API:**

**External contract for pipelines (similar to `uploadShort` for YouTube):**
```typescript
async function uploadShortToTikTok(params: TikTokUploadParams): Promise<{ postId: string }>
```

**Internal helper (for testability, similar to `uploadVideoWithAccessToken` for YouTube):**
```typescript
async function uploadVideoToTikTokWithAccessToken(
  params: TikTokUploadParams,
  accessToken: string,
): Promise<TikTokUploadResult>
```

**How this interface minimizes changes in pipelines:**
- ✅ Pipeline continues to call `tiktok.uploadVideo()` with same params
- ✅ Pipeline continues to expect `{ videoId: string }` (maps to `postId` in TikTok)
- ✅ Error handling via `TikTokApiError` class (can be mapped to `TikTokUploadErrorResult`)

**How this aligns with YouTube/TikTok symmetry:**
- ✅ Same discriminated union pattern (`ok: true | false`)
- ✅ Same error code union pattern (`INVALID_TOKEN`, `RATE_LIMITED`, etc.)
- ✅ Same retryable flag pattern (`isRetryable: boolean`)
- ✅ Same token handling pattern (pipeline fetches token, passes to client)

**Proposed client class structure:**
```typescript
class TikTokClient {
  constructor(config: { accessToken: string; supabase?: SupabaseClient })
  async uploadVideo(params: TikTokUploadParams): Promise<{ postId: string }>
  // Internal: checks TIKTOK_UPLOAD_MODE, calls uploadVideoToTikTokWithAccessToken if "real"
}
```

---

## 6. Security & Testing Strategy

### 6.1 Security & Secret Handling

**How we handle TikTok secrets:**

**Storage:**
- Tokens stored in Supabase `connected_accounts` table
- Fields: `access_token_encrypted_ref`, `refresh_token_encrypted_ref`
- Encryption: JSON envelope format `{ v: 1, purpose: "tiktok_token", secret: "<encrypted>" }`
- Encryption utilities: `encryptSecret()` / `decryptSecret()` from `@cliply/shared/crypto/encryptedSecretEnvelope`

**Encryption/decryption:**
- ✅ Reuses existing patterns from YouTube/TikTok auth
- ✅ Same envelope format as YouTube (different purpose strings)
- ✅ Tokens decrypted only when needed (in `getFreshTikTokAccessToken`)

**How we avoid logging:**
- ✅ Access tokens never logged (tokens are plaintext only in memory, never in logs)
- ✅ Sensitive TikTok error bodies: Only log `tiktokErrorCode` and `tiktokErrorMessage` (sanitized), not full response
- ✅ Video file contents: Never logged (only file paths and metadata)

**Token refresh security:**
- ✅ Refresh tokens stored encrypted (same as access tokens)
- ✅ Token refresh happens server-side only (never exposed to client)
- ✅ Token refresh updates DB atomically (prevents race conditions)

### 6.2 Testing Strategy

**Unit tests:**

**Mock TikTok HTTP responses:**
- Mock `fetch()` calls to TikTok API endpoints
- Simulate success responses (200 OK with `video_id`)
- Simulate error responses:
  - `401 Unauthorized` → `INVALID_TOKEN`
  - `403 Forbidden` → `INSUFFICIENT_SCOPE` or `FORBIDDEN`
  - `429 Too Many Requests` → `RATE_LIMITED`
  - `400 Bad Request` → `BAD_REQUEST`
  - `500 Internal Server Error` → `TIKTOK_5XX`
- Test retryable vs. fatal error classification
- Test three-step upload flow (init → upload → publish)

**Test files:**
- `apps/worker/test/services/tiktok/client.test.ts` (new)
- Mock helpers: `apps/worker/test/helpers/mockTikTokApi.ts` (new)

**Integration tests:**

**Run against mock HTTP server:**
- Use `msw` (Mock Service Worker) or similar to intercept TikTok API calls
- Test full upload flow with mock responses
- Test error scenarios with mock error responses
- **No live TikTok integration tests in CI** (too risky, requires real tokens)

**Gating:**

**`TIKTOK_UPLOAD_MODE` flag for tests:**
- `"stub"` by default (no network calls)
  - Returns fake `postId` (e.g., `"stub_${randomUUID()}"`)
  - No actual HTTP requests
  - Fast, deterministic tests
- `"real"` only in controlled environments
  - Requires real TikTok OAuth tokens
  - Only for manual testing or staging environment
  - Never in CI (too risky, rate limits, costs)

**Test coverage goals:**
- ✅ Unit tests: 80%+ coverage of TikTok client
- ✅ Integration tests: Full upload flow (stub mode)
- ✅ Pipeline tests: Mock TikTok client, test pipeline integration (already exists)

---

## 7. Implementation Substeps (T2-1a, T2-1b, ...)

Break the future coding work into small, numbered substeps:

### T2-1a — Introduce TikTok Types Module

**Goal:** Create type definitions matching YouTube pattern

**Files expected to change:**
- `apps/worker/src/services/tiktok/types.ts` (new)
  - `TikTokPrivacyLevel`
  - `TikTokUploadParams`
  - `TikTokClientErrorCode`
  - `TikTokClientErrorDetails`
  - `TikTokUploadSuccessResult`
  - `TikTokUploadErrorResult`
  - `TikTokUploadResult`

**Risks & rollback strategy:**
- Low risk — types only, no runtime changes
- Rollback: Delete file, no impact on existing code

### T2-1b — Refactor TikTok Client to Use New Types

**Goal:** Update existing `TikTokClient` to use new types and return discriminated union

**Files expected to change:**
- `apps/worker/src/services/tiktok/client.ts`
  - Import types from `./types`
  - Update `uploadVideo()` to return `TikTokUploadResult` instead of `UploadVideoResult`
  - Map `TikTokApiError` to `TikTokUploadErrorResult`
  - Keep existing three-step upload flow (no changes to API calls)

**Risks & rollback strategy:**
- Medium risk — changes return type, may break pipeline
- Rollback: Revert to old return type, pipeline already handles `{ videoId: string }`
- Mitigation: Update pipeline in same PR or keep backward-compatible adapter

### T2-1c — Add Env Flag `TIKTOK_UPLOAD_MODE` and Gate Stub vs Real Path

**Goal:** Add stub mode for testing, gate real API calls behind env flag

**Files expected to change:**
- `apps/worker/src/services/tiktok/client.ts`
  - Check `TIKTOK_UPLOAD_MODE` env var (default: `"stub"`)
  - If `"stub"`: Return fake `postId` without making API calls
  - If `"real"`: Use existing real API implementation
- `packages/shared/src/env.ts` (if needed)
  - Add `TIKTOK_UPLOAD_MODE?: "stub" | "real"` to env schema
- `.env.example` (if needed)
  - Add `TIKTOK_UPLOAD_MODE=stub` example

**Risks & rollback strategy:**
- Low risk — adds feature, doesn't break existing behavior (defaults to stub)
- Rollback: Remove env check, always use real API (revert to current behavior)

### T2-1d — Add Tests for TikTok Client Gating (Stub vs Real, Mocked Helpers)

**Goal:** Test stub mode and real mode (with mocked HTTP)

**Files expected to change:**
- `apps/worker/test/services/tiktok/client.test.ts` (new)
  - Test stub mode returns fake `postId`
  - Test real mode with mocked `fetch()` calls
  - Test error scenarios (401, 403, 429, 500)
  - Test three-step upload flow
- `apps/worker/test/helpers/mockTikTokApi.ts` (new)
  - Helper functions to mock TikTok API responses

**Risks & rollback strategy:**
- Low risk — tests only, no runtime impact
- Rollback: Delete test files, no impact on production code

### T2-1e — Update Pipeline to Handle New Return Type

**Goal:** Update `publish-tiktok` pipeline to handle `TikTokUploadResult` discriminated union

**Files expected to change:**
- `apps/worker/src/pipelines/publish-tiktok.ts`
  - Update to handle `TikTokUploadResult` (check `ok` flag)
  - Extract `postId` from success result
  - Handle error result with proper error mapping
  - Keep existing error handling patterns (logging, Sentry)

**Risks & rollback strategy:**
- Medium risk — changes error handling flow
- Rollback: Revert to old pattern, catch `TikTokApiError` directly
- Mitigation: Test thoroughly with both success and error cases

### T2-1f — Polish Logging/Telemetry and Finalize Documentation

**Goal:** Ensure consistent logging patterns and update documentation

**Files expected to change:**
- `apps/worker/src/services/tiktok/client.ts`
  - Add structured logging for upload steps (init, upload, publish)
  - Ensure sensitive data is not logged
- `apps/worker/src/pipelines/publish-tiktok.ts`
  - Ensure logging matches patterns from Section 4.4
- `REPORTS/T2-00-tiktok-client-plan.md` (this file)
  - Mark as complete, add implementation notes

**Risks & rollback strategy:**
- Low risk — logging only, no functional changes
- Rollback: Revert logging changes, no impact on functionality

---

## 8. Open Questions & Assumptions

### 8.1 Open Questions

1. **Scheduling support:**
   - **Question:** Do we need scheduling in MVP, or is "post-now" enough?
   - **Current assumption:** "Post-now" is sufficient for MVP (TikTok API doesn't support scheduling anyway)
   - **Future:** If TikTok adds scheduling API, we can add it later

2. **Video format validation:**
   - **Question:** Should we validate video format/duration before uploading?
   - **Current assumption:** Let TikTok API reject invalid videos (simpler, but less user-friendly)
   - **Alternative:** Pre-validate in pipeline (more complex, better UX)

3. **Content moderation errors:**
   - **Question:** How do we want to handle content moderation errors (e.g., do we surface them in the UI)?
   - **Current assumption:** Log error, fail job, user sees error in job status
   - **Future:** Could add specific error codes for moderation (e.g., `CONTENT_MODERATION_REJECTED`)

4. **Caption generation:**
   - **Question:** How strongly do we want to couple TikTok caption generation to Cliply's AI caption pipeline?
   - **Current assumption:** Pipeline accepts `caption` from payload or uses `clip.caption_suggestion` (loose coupling)
   - **Future:** Could add TikTok-specific caption formatting (hashtag extraction, length limits, etc.)

5. **Hashtag extraction:**
   - **Question:** Should we extract hashtags from caption automatically, or require separate `hashtags` param?
   - **Current assumption:** Hashtags are part of caption (TikTok extracts them automatically)
   - **Future:** Could add hashtag extraction/validation logic

6. **Multi-account support:**
   - **Question:** Do we need to support multiple TikTok accounts per workspace?
   - **Current assumption:** Yes (already supported via `connected_accounts` table, one account per workspace currently)
   - **Future:** Could add multi-account selection UI (similar to YouTube)

### 8.2 Assumptions

1. **TikTok API stability:**
   - Assumption: TikTok Content Posting API v2 is stable and won't change significantly
   - Risk: API changes could break implementation
   - Mitigation: Monitor TikTok API changelog, version API calls if needed

2. **Token refresh reliability:**
   - Assumption: `getFreshTikTokAccessToken` reliably refreshes tokens
   - Risk: Token refresh could fail, causing upload failures
   - Mitigation: Already implemented and tested in OAuth flow

3. **Video file accessibility:**
   - Assumption: Pipeline has access to video file at `storage_path` (can download from storage)
   - Risk: Storage access could fail
   - Mitigation: Already handled in pipeline (downloads to temp file, cleans up)

4. **Rate limits:**
   - Assumption: TikTok rate limits are reasonable for our use case
   - Risk: Rate limits could be too restrictive
   - Mitigation: Monitor rate limit errors, implement backoff (already in worker queue)

5. **Error message clarity:**
   - Assumption: TikTok API error messages are clear enough for debugging
   - Risk: Error messages could be cryptic
   - Mitigation: Log full error details (sanitized), map to our error codes

---

## Appendix: Comparison with YouTube Implementation

### Similarities

- ✅ Same three-step pattern: Token fetch → Client call → Result handling
- ✅ Same error handling pattern: Discriminated union with `ok` flag
- ✅ Same retry strategy: Worker queue handles retries, client marks retryable
- ✅ Same token management: `getFresh*AccessToken` pattern
- ✅ Same logging patterns: Structured logs, Sentry integration

### Differences

- ⚠️ **Upload flow:** YouTube uses resumable upload, TikTok uses three-step init/upload/publish
- ⚠️ **API structure:** YouTube single endpoint with multipart, TikTok three separate endpoints
- ⚠️ **Scheduling:** YouTube supports `publishAt`, TikTok does not
- ⚠️ **Error codes:** Different API error codes, but we map to similar domain codes
- ⚠️ **Current state:** TikTok client already has real implementation, YouTube was stubbed

### Migration Path

- **Step 1:** Standardize TikTok types to match YouTube pattern (T2-1a)
- **Step 2:** Add stub mode for testing (T2-1c)
- **Step 3:** Update pipeline to use new types (T2-1e)
- **Step 4:** Add comprehensive tests (T2-1d)
- **Step 5:** Polish and document (T2-1f)

---

**End of Plan**

