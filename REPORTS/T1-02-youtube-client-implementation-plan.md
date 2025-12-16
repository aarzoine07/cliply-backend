# T1-02 — YouTube Client Implementation Plan

**Status:** Planning (Documentation Only)  
**Track:** T1 — YouTube Publishing & OAuth Completion  
**Created:** 2025-01-XX  
**Purpose:** Detailed implementation plan for replacing stubbed YouTube client with real YouTube Data API v3 integration

---

## 1. Current State Snapshot

### 1.1 Client Stub API

**File:** `apps/worker/src/services/youtube/client.ts`

**Exported functions and signatures:**
- `class YouTubeClient`
  - Constructor: `constructor(config: { accessToken: string })`
  - Method: `async uploadShort(params: UploadShortParams): Promise<{ videoId: string }>`
- `interface UploadShortParams`
  - Fields: `filePath: string`, `title: string`, `description?: string`, `tags?: string[]`, `visibility?: 'public' | 'unlisted' | 'private'`

**What the stub currently returns:**
- `{ videoId: string }` where `videoId` is always `dryrun_${randomUUID()}`
- No actual API calls are made
- No error handling (always succeeds)

**Current implementation (lines 23-25):**
```typescript
async uploadShort(_params: UploadShortParams): Promise<{ videoId: string }> {
  return { videoId: `dryrun_${randomUUID()}` };
}
```

### 1.2 Call Sites & Usage

**Primary pipeline:** `apps/worker/src/pipelines/publish-youtube.ts`

**How it calls the client (lines 199-206):**
1. Gets fresh access token via `getFreshYouTubeAccessToken(payload.connectedAccountId, { supabase: ctx.supabase })`
2. Instantiates `YouTubeClient` with the access token
3. Calls `youtube.uploadShort()` with:
   - `filePath`: temporary downloaded file path (local file system)
   - `title`: from payload or defaults to `"Cliply Short"`
   - `description`: from payload (optional)
   - `tags`: from payload (optional array)
   - `visibility`: from payload (optional, 'public' | 'unlisted' | 'private')
4. Expects back: `{ videoId: string }`

**Post-upload actions (lines 208-306):**
- Updates `clips` table: sets `status = 'published'`, `external_id = response.videoId`, `published_at = now()`
- Updates `variant_posts` table if experimentId/variantId present
- Records usage via `recordUsage()` for billing
- Advances project `pipeline_stage` to `'PUBLISHED'`
- Marks schedule as `sent`

**Error handling context:**
- Pipeline wraps client call in try-catch (line 315)
- Errors are logged with structured logging (`ctx.logger.error("pipeline_failed", ...)`)
- Errors are sent to Sentry (`ctx.sentry.captureException(error, ...)`)
- Errors are re-thrown, causing job to fail/retry via worker queue system
- Worker uses exponential backoff (2^(attempts-1) * 10 seconds, max 1800s) with max attempts

**Other modules:**
- No other direct callers found (grep confirmed)
- Client is only used by `publish-youtube` pipeline

### 1.3 Token & Auth Context

**Token retrieval:**
- Function: `getFreshYouTubeAccessToken(accountId: string, ctx: { supabase: SupabaseClient }): Promise<string>`
- Location: `packages/shared/src/services/youtubeAuth.ts` (lines 298-370)
- Behavior:
  - Fetches `connected_accounts` row where `platform = 'youtube'` and `id = accountId`
  - Checks if token expires within 5 minutes
  - If expired/expiring: refreshes using `refresh_token_encrypted_ref`
  - Returns plaintext access token (ready for `Authorization: Bearer` header)
  - Handles encryption/decryption of stored tokens (`encryptYouTubeToken` / `decryptYouTubeToken`)

**OAuth scope:**
- Currently requested: `https://www.googleapis.com/auth/youtube.upload` (line 100 in `youtubeAuth.ts`)
- This scope is sufficient for video uploads and basic metadata

**Stored account data:**
- Table: `connected_accounts`
- Fields used: `id`, `access_token_encrypted_ref`, `refresh_token_encrypted_ref`, `expires_at`, `platform`
- Additional fields (if needed): `workspace_id`, `channel_id`, `channel_title` (from OAuth flow via `fetchYouTubeChannelForToken`)

**Constraints/TODOs:**
- Token refresh is already handled — client doesn't need to handle it
- Access tokens are returned as plaintext strings (ready for API calls)
- No additional encryption needed in client — tokens are already decrypted by `getFreshYouTubeAccessToken`

---

## 2. Target Behaviour & YouTube API Surface

### 2.1 Core Operations

**MVP Operation: `uploadShort` (required)**

**Inputs:**
- `filePath: string` — Local file path to MP4 video file
- `title: string` — Video title
- `description?: string` — Video description
- `tags?: string[]` — Array of tag strings (max 500 chars total, max 10 tags)
- `visibility?: 'public' | 'unlisted' | 'private'` — Privacy setting

**Outputs:**
- `{ videoId: string }` — YouTube video ID (e.g., `"dQw4w9WgXcQ"`)
- Future enhancement: could include `uploadStatus`, `publishedAt`, etc., but MVP only needs `videoId`

**YouTube API Flow:**
YouTube Data API v3 uses a **resumable upload** flow:
1. **Initialize upload** → POST to `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
2. **Upload video file** → PUT to the resumable upload URL (can be chunked)
3. **Poll status** (optional) → GET to check upload progress (we can skip for MVP)

**Alternative (simpler, but less reliable for large files):**
- Use `uploadType=multipart` → single POST with metadata + file data (simpler, but less suitable for large files)

**Recommended for MVP:**
- Use **resumable upload** (`uploadType=resumable`) for reliability, but implement simple version (no chunking for now)
- If upload fails mid-way, worker retry mechanism will handle it

**Future operations (out of scope for MVP):**
- `updateVideoMetadata` — For post-upload edits (use `videos.update`)
- `setThumbnail` — For custom thumbnails (use `thumbnails.set`, requires additional scope)
- `schedulePublish` — For scheduled publishing (use `publishAt` in status part, or internal scheduling)

### 2.2 YouTube Data API Endpoints

**Operation: `uploadShort`**

**Endpoint:** `https://www.googleapis.com/upload/youtube/v3/videos`

**HTTP Method & URL:**
1. **Step 1 — Initialize resumable upload:**
   - `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
   - Headers:
     - `Authorization: Bearer {accessToken}`
     - `Content-Type: application/json`
     - `X-Upload-Content-Type: video/mp4`
     - `X-Upload-Content-Length: {fileSizeInBytes}`
   - Body (JSON):
     ```json
     {
       "snippet": {
         "title": "{title}",
         "description": "{description}",
         "tags": ["tag1", "tag2", ...],
         "categoryId": "22"  // People & Blogs (for Shorts, could also use "24" Entertainment)
       },
       "status": {
         "privacyStatus": "public" | "unlisted" | "private",
         "selfDeclaredMadeForKids": false
       }
     }
     ```
   - Response:
     - Status: `200 OK`
     - Header: `Location: {resumableUploadUrl}` (absolute URL)
     - Body: Empty or minimal JSON

2. **Step 2 — Upload video file:**
   - `PUT {resumableUploadUrl}` (from `Location` header)
   - Headers:
     - `Content-Type: video/mp4`
     - `Content-Length: {fileSizeInBytes}`
   - Body: Raw video file bytes (from `readFile(filePath)`)
   - Response:
     - Status: `200 OK` or `308 Resume Incomplete` (for chunked uploads — we skip chunking for MVP)
     - Body (JSON):
       ```json
       {
         "kind": "youtube#video",
         "etag": "...",
         "id": "dQw4w9WgXcQ",  // ← This is the videoId we need
         "snippet": { ... },
         "status": { ... }
       }
       ```

**Required OAuth Scope:**
- `https://www.googleapis.com/auth/youtube.upload` — ✅ Already requested in OAuth flow

**Request/Response shapes (key fields we care about):**

**Initialize request:**
- `snippet.title`: string (max 100 chars)
- `snippet.description`: string (max 5000 chars)
- `snippet.tags`: string[] (max 10 tags, 30 chars each, 500 chars total)
- `status.privacyStatus`: "public" | "unlisted" | "private"

**Upload response:**
- `id`: string (video ID, e.g., "dQw4w9WgXcQ")

**Error responses (common):**
- `400 Bad Request`: Invalid metadata (title too long, invalid tags, etc.)
- `401 Unauthorized`: Invalid/expired token (shouldn't happen if `getFreshYouTubeAccessToken` works)
- `403 Forbidden`: Quota exceeded, insufficient permissions, or channel not eligible
- `408 Request Timeout`: Upload timeout (for large files)
- `413 Payload Too Large`: File too large (YouTube has size limits)
- `429 Too Many Requests`: Rate limit exceeded
- `500/502/503/504`: Transient server errors (retryable)

---

## 3. Env Vars, Config, and Scopes

### 3.1 Required Env Vars

**Existing env vars (reuse):**
- `GOOGLE_CLIENT_ID` — Already used by OAuth flow (`packages/shared/src/services/youtubeAuth.ts`)
- `GOOGLE_CLIENT_SECRET` — Already used by OAuth flow
- No new env vars needed for MVP — client only needs access token (passed via constructor)

**Future env vars (optional, not for MVP):**
- `YOUTUBE_API_BASE_URL` — Could hard-code `https://www.googleapis.com/upload/youtube/v3` for now
- `YOUTUBE_UPLOAD_TIMEOUT_MS` — Could hard-code `10 * 60 * 1000` (10 minutes) for now
- `YOUTUBE_UPLOAD_MAX_FILE_SIZE_MB` — Could hard-code limit (YouTube allows up to 256GB, but Shorts are typically < 100MB)

**Module reading env vars:**
- `apps/worker/src/services/youtube/client.ts` — Will import `getEnv()` if needed for timeouts/config
- Currently no env vars needed — client is stateless except for access token

**Required for:**
- Tests: No env vars needed (mock fetch)
- Dev: No env vars needed (uses real YouTube API if tokens are valid)
- Prod: No env vars needed (uses real YouTube API)

### 3.2 OAuth Scopes & Permissions

**Current scope:** `https://www.googleapis.com/auth/youtube.upload`

**Scope capabilities:**
- ✅ Upload videos (`videos.insert`)
- ✅ Update metadata (if we add `updateVideoMetadata` later)
- ✅ Set privacy status
- ❌ Set custom thumbnails (requires `https://www.googleapis.com/auth/youtube` or `https://www.googleapis.com/auth/youtube.force-ssl`)
- ❌ Delete videos (requires broader scope)
- ❌ Read video analytics (requires `https://www.googleapis.com/auth/yyt.analytics.readonly`)

**Alignment with existing OAuth:**
- ✅ Current OAuth flow requests `youtube.upload` scope (line 100 in `youtubeAuth.ts`)
- ✅ No changes needed to OAuth flow for MVP
- ✅ Scope is sufficient for video uploads

**Backwards compatibility:**
- No concerns — all existing connected accounts should have `youtube.upload` scope (it's the only scope requested)

**Future scope additions (not MVP):**
- If we add thumbnail upload: request `youtube` scope in addition to `youtube.upload`
- If we add scheduling: `youtube.upload` is sufficient (scheduling is via `publishAt` field)
- No breaking changes — new scopes would be additive

---

## 4. Error Handling, Retries, and Logging

### 4.1 Failure Modes

**Expected YouTube API failure scenarios:**

1. **Invalid/expired token (401/403)**
   - **Cause:** Token refresh failed, or token revoked by user
   - **Likelihood:** Low (we refresh proactively), but possible
   - **Retryable:** No (refresh will fail again)
   - **Action:** Mark job as failed, notify user to reconnect account

2. **Quota exceeded (403 with quota error)**
   - **Cause:** YouTube daily quota exceeded (default: 10,000 units/day, upload = 1600 units)
   - **Likelihood:** Medium (possible at scale)
   - **Retryable:** Yes, after quota resets (next day)
   - **Action:** Log with quota info, mark job for retry with backoff

3. **Invalid request (400)**
   - **Causes:**
     - Title too long (> 100 chars)
     - Description too long (> 5000 chars)
     - Tags invalid (too many, too long, or special characters)
     - File format unsupported (though we ensure MP4)
   - **Likelihood:** Low (we should validate before upload)
   - **Retryable:** No (fixable, but requires code change)
   - **Action:** Log error details, mark job as failed

4. **Transient network errors (5xx, network timeouts)**
   - **Causes:** YouTube API downtime, network issues, timeouts during upload
   - **Likelihood:** Low-medium (possible during long uploads)
   - **Retryable:** Yes (exponential backoff)
   - **Action:** Retry via worker queue with backoff

5. **Rate limit exceeded (429)**
   - **Cause:** Too many requests per second/minute
   - **Likelihood:** Low (YouTube has generous rate limits)
   - **Retryable:** Yes (with exponential backoff)
   - **Action:** Retry with backoff, respect `Retry-After` header if present

6. **File too large (413)**
   - **Cause:** Video file exceeds YouTube limits
   - **Likelihood:** Low (we should validate file size before upload)
   - **Retryable:** No (file is too large)
   - **Action:** Mark job as failed, log error

7. **Upload timeout (408)**
   - **Cause:** Upload takes too long (network slow, file large)
   - **Likelihood:** Low-medium (for large files)
   - **Retryable:** Yes (with resumable upload, can resume from last chunk — but we skip chunking for MVP)
   - **Action:** Retry full upload (MVP), or implement resumable resume (future)

### 4.2 Mapping Errors to Our Domain

**Client error representation:**

**Option 1: Throw custom error class (recommended, matches TikTok pattern)**
```typescript
class YouTubeApiError extends Error {
  readonly status: number;
  readonly youtubeErrorCode?: string;
  readonly youtubeErrorMessage?: string;
  readonly retryable: boolean;
  readonly quotaExceeded?: boolean;
}
```

**Option 2: Return discriminated union (not recommended — breaks existing interface)**
```typescript
type UploadResult = 
  | { ok: true; videoId: string }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean };
```

**Recommendation:** Use **Option 1** (throw `YouTubeApiError`) to match TikTok client pattern and existing pipeline error handling.

**Error mapping:**

| HTTP Status | YouTube Error Code | Our Error | Retryable? | Quota? |
|-------------|-------------------|-----------|------------|--------|
| 400 | `invalidMetadata` | `YouTubeApiError` (not retryable) | ❌ | ❌ |
| 401 | `unauthorized` | `YouTubeApiError` (not retryable) | ❌ | ❌ |
| 403 | `quotaExceeded` | `YouTubeApiError` (retryable, quota=true) | ✅ | ✅ |
| 403 | `forbidden` | `YouTubeApiError` (not retryable) | ❌ | ❌ |
| 408 | `timeout` | `YouTubeApiError` (retryable) | ✅ | ❌ |
| 413 | `payloadTooLarge` | `YouTubeApiError` (not retryable) | ❌ | ❌ |
| 429 | `rateLimitExceeded` | `YouTubeApiError` (retryable) | ✅ | ❌ |
| 500-504 | `serverError` | `YouTubeApiError` (retryable) | ✅ | ❌ |
| Network error | `networkError` | `YouTubeApiError` (retryable) | ✅ | ❌ |

**Pipeline error handling:**

**Current behavior (lines 315-326):**
- Pipeline catches all errors (including `YouTubeApiError`)
- Logs structured error: `ctx.logger.error("pipeline_failed", { pipeline, jobId, workspaceId, error: message })`
- Sends to Sentry: `ctx.sentry.captureException(error, { tags: { pipeline }, extra: { jobId, workspaceId } })`
- Re-throws error → worker queue handles retry/backoff

**Recommended pipeline changes:**
- No changes needed — existing error handling works
- If we want to distinguish quota errors, we can check `error.quotaExceeded` in pipeline and log differently
- For quota errors, could mark job with longer backoff (24 hours instead of exponential)

**Dead-letter queue (DLQ) behavior:**
- Worker marks job as failed after `max_attempts` (default: 3)
- Failed jobs go to DLQ (via `worker_fail` RPC)
- Quota errors should retry longer — consider increasing `max_attempts` for quota errors (future enhancement)

### 4.3 Retry Strategy

**Retry location:**
- **Worker queue** (existing) — Handles job-level retries with exponential backoff
- **Client** (not recommended) — Don't add client-level retries (would duplicate worker retry logic)

**Retry categories:**

1. **Retryable errors (exponential backoff):**
   - 5xx server errors
   - 429 rate limit
   - 408 timeout
   - Network errors
   - Default backoff: `2^(attempts-1) * 10` seconds, max 1800s (30 min)

2. **Retryable but longer backoff (quota):**
   - 403 quota exceeded
   - Could use 24-hour backoff (future enhancement)
   - For MVP: use standard exponential backoff (will retry next day if quota resets)

3. **Not retryable (immediate failure):**
   - 400 invalid request (fix code, don't retry)
   - 401 unauthorized (reconnect account, don't retry)
   - 403 forbidden (insufficient permissions, don't retry)
   - 413 payload too large (file issue, don't retry)

**Idempotency:**
- **YouTube API is NOT idempotent** — each upload creates a new video
- **Risk:** Worker retry could upload duplicate video if upload succeeds but response is lost
- **Mitigation:**
  - Check `clip.external_id` before upload (already done in pipeline, line 100)
  - If `external_id` exists, skip upload (idempotency check)
  - For resumable uploads, YouTube provides upload session ID — could track this to resume interrupted uploads (future)

**Resumable upload resume (future, not MVP):**
- YouTube resumable uploads can be resumed using `Range` header
- Track upload session URL in job metadata or database
- On retry, check if upload session exists and resume from last byte
- For MVP: always start fresh upload (simpler, acceptable for small Shorts files)

### 4.4 Logging & Telemetry

**Structured logging (matches existing patterns):**

**Success logs:**
- In client: `logger.info("youtube_upload_success", { videoId, fileSize, durationMs })`
- In pipeline: Already logs `pipeline_completed` with `videoId` (line 308)

**Retry logs:**
- Worker logs: `logJobStatus(..., "retry", { attempts, backoffSeconds, error })` (existing)
- Client: No separate retry logs (worker handles it)

**Failure logs:**
- In client: `logger.error("youtube_upload_failed", { status, errorCode, errorMessage, retryable })`
- In pipeline: Already logs `pipeline_failed` with error (line 320)
- Sentry: Already captures exceptions with context (line 316)

**Telemetry fields (add to logs):**
- `videoId` (on success)
- `fileSize` (bytes)
- `uploadDurationMs` (time taken)
- `youtubeErrorCode` (on error)
- `youtubeErrorMessage` (on error)
- `quotaExceeded` (boolean, on 403)
- `retryable` (boolean)

**Logging patterns (match existing):**
- Use structured JSON logging: `ctx.logger.info("event_name", { field1, field2, ... })`
- Match TikTok client logging style (see `apps/worker/src/services/tiktok/client.ts`)

**Sentry context:**
- Pipeline already adds `tags: { pipeline: PIPELINE }` and `extra: { jobId, workspaceId }`
- Client errors will be caught by pipeline and sent to Sentry automatically
- No additional Sentry setup needed

---

## 5. Client API Shape (Type-Level Design)

### 5.1 Public Types

**Types (TypeScript interfaces):**

```typescript
// Existing (keep as-is)
export interface UploadShortParams {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
}

// Existing (keep as-is)
export interface UploadShortResult {
  videoId: string;
}

// New (for error handling)
export class YouTubeApiError extends Error {
  readonly status: number;
  readonly youtubeErrorCode?: string;
  readonly youtubeErrorMessage?: string;
  readonly retryable: boolean;
  readonly quotaExceeded?: boolean;

  constructor(
    message: string,
    status: number,
    options?: {
      youtubeErrorCode?: string;
      youtubeErrorMessage?: string;
      retryable?: boolean;
      quotaExceeded?: boolean;
    }
  );
}
```

**Note:** Keep existing `UploadShortParams` and `UploadShortResult` interfaces unchanged to minimize pipeline changes.

### 5.2 Client Interface

**Public interface:**

```typescript
export class YouTubeClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: { accessToken: string });

  /**
   * Upload a video to YouTube Shorts.
   * Implements YouTube Data API v3 resumable upload flow:
   * 1. Initialize resumable upload (get upload URL)
   * 2. Upload video file to upload URL
   * Returns YouTube video ID on success.
   * Throws YouTubeApiError on failure.
   */
  async uploadShort(params: UploadShortParams): Promise<UploadShortResult>;
}
```

**Helper methods (private, internal):**

```typescript
/**
 * Step 1: Initialize resumable upload
 * Returns resumable upload URL from Location header
 */
private async initializeUpload(params: UploadShortParams): Promise<string>;

/**
 * Step 2: Upload video file to resumable URL
 * Returns video ID from response
 */
private async uploadFile(uploadUrl: string, filePath: string): Promise<string>;

/**
 * Make HTTP request with error handling
 * Returns parsed JSON response with status code
 * Throws YouTubeApiError on failure
 */
private async makeRequest(url: string, options: RequestInit): Promise<{ status: number; [key: string]: unknown }>;

/**
 * Parse YouTube API error response
 * Returns structured error info
 */
private parseErrorResponse(response: Response, errorText: string): { code?: string; message: string };
```

**Interface compatibility:**
- ✅ Matches existing interface (same method name, same params, same return type)
- ✅ No changes needed in `publish-youtube.ts` pipeline
- ✅ Only implementation changes (stub → real API calls)

**Error handling:**
- ✅ Throws `YouTubeApiError` (matches TikTok pattern)
- ✅ Pipeline catches and handles (existing error handling works)
- ✅ No breaking changes

---

## 6. Security, Compliance, and Testing Strategy

### 6.1 Security & Secret Handling

**Token security:**
- ✅ Access tokens are passed via constructor (plaintext, but scoped to client instance)
- ✅ Tokens are not logged (never log `accessToken` value)
- ✅ Tokens are not stored in client (only in memory during request)
- ✅ Token refresh handled by `getFreshYouTubeAccessToken` (client doesn't handle refresh)

**Sensitive data logging:**
- ❌ Don't log: `accessToken`, `refreshToken`, full URLs with tokens
- ✅ Do log: `videoId`, `status`, `errorCode`, `fileSize`, `durationMs`
- ✅ Log truncated/redacted error messages if they contain tokens

**Request security:**
- ✅ Use HTTPS for all YouTube API calls (hard-coded `https://www.googleapis.com/...`)
- ✅ Use `Authorization: Bearer {token}` header (standard OAuth 2.0)
- ✅ No API keys needed (OAuth token is sufficient)

**File security:**
- ✅ File paths are local (worker filesystem) — no network exposure
- ✅ Files are cleaned up after upload (pipeline calls `cleanupTempFileSafe` in finally block)
- ✅ No file content logged (only file size)

**Compliance:**
- ✅ YouTube Terms of Service — users grant consent via OAuth flow
- ✅ GDPR/privacy — no PII logged (only video IDs, which are public once published)
- ✅ No data retention — files are temporary, cleaned up after upload

### 6.2 Testing Strategy

**Unit tests (`test/services/youtube/client.test.ts`):**

**Mock strategy:**
- Mock `fetch` globally (using `vitest` or `jest`)
- Mock file system (`readFile`) for file operations
- No real YouTube API calls in unit tests

**Test cases:**
1. **Happy path:**
   - Mock successful `initializeUpload` response (200, `Location: https://upload.example.com/...`)
   - Mock successful `uploadFile` response (200, `{ id: "abc123" }`)
   - Assert: returns `{ videoId: "abc123" }`

2. **Error handling:**
   - Test 400 (invalid metadata) → throws `YouTubeApiError` (not retryable)
   - Test 401 (unauthorized) → throws `YouTubeApiError` (not retryable)
   - Test 403 quota → throws `YouTubeApiError` (retryable, quota=true)
   - Test 429 rate limit → throws `YouTubeApiError` (retryable)
   - Test 5xx → throws `YouTubeApiError` (retryable)
   - Test network timeout → throws `YouTubeApiError` (retryable)

3. **Edge cases:**
   - Empty title → YouTube API should accept (or reject with 400)
   - Very long title (> 100 chars) → should fail with 400
   - Empty tags array → should work (no tags)
   - Many tags (> 10) → should fail with 400
   - Large file (> YouTube limit) → should fail with 413

4. **Retry behavior:**
   - Client doesn't retry (worker handles retries)
   - Tests verify error `retryable` flag is correct

**Integration tests (`test/pipelines/publish-youtube.integration.test.ts`):**

**Mock strategy:**
- Mock YouTube API (`fetch` mocked to return realistic responses)
- Use real pipeline code (no mocks for pipeline logic)
- Use test Supabase instance (or mocked Supabase client)

**Test cases:**
1. **Full pipeline happy path:**
   - Create test clip in DB
   - Mock YouTube upload success
   - Run pipeline
   - Assert: clip `external_id` updated, `status = 'published'`, variant_post updated

2. **Pipeline error handling:**
   - Mock YouTube upload failure (quota error)
   - Run pipeline
   - Assert: error logged, job fails, clip not updated

3. **Idempotency:**
   - Run pipeline twice with same clip (first succeeds, second has `external_id`)
   - Assert: second run skips upload (early return, line 100-104)

**E2E tests (future, T1-04):**
- Use real YouTube API with test account
- Requires real OAuth tokens (test account)
- Full pipeline: download → transcribe → highlight → render → publish to YouTube
- Mark as `@skip` in CI (manual run only, or use test account credentials)

**Test file structure:**
```
test/
  services/
    youtube/
      client.test.ts          # Unit tests for YouTubeClient
  pipelines/
    publish-youtube.integration.test.ts  # Integration tests for pipeline
  engine/
    full-pipeline-youtube.e2e.test.ts    # E2E test (T1-04, future)
```

**Test data:**
- Use small test video file (< 1MB) for unit tests
- File path: `test/fixtures/test-video.mp4` (create if needed)
- Or mock `readFile` to return Buffer (no real file needed)

**Test performance:**
- Unit tests: < 100ms each (mocked fetch)
- Integration tests: < 1s each (mocked API, real DB queries)
- E2E tests: ~30s each (real API, real upload)

**Deterministic tests:**
- Mock all external dependencies (YouTube API, file system)
- No flakiness from network or API rate limits
- Use fixed test data (no random UUIDs in assertions)

---

## 7. Implementation Substeps (T1-2a, T1-2b, ...)

### T1-2a — Introduce YouTube Client Error Types & Structure

**Goal:** Add error types and client structure without network calls (still stubbed).

**Files to change:**
- `apps/worker/src/services/youtube/client.ts`

**Changes:**
- Add `YouTubeApiError` class (matches TikTok pattern)
- Add private helper method stubs: `initializeUpload()`, `uploadFile()`, `makeRequest()`
- Keep `uploadShort()` as stub (returns fake ID)
- Add JSDoc comments for future implementation

**Risks:** Low (no behavior changes, just structure)

**Rollback:** Revert file to previous state

**Tests:** No new tests needed (behavior unchanged)

---

### T1-2b — Implement Real `uploadShort` with YouTube Data API

**Goal:** Replace stub with real API calls to YouTube Data API v3.

**Files to change:**
- `apps/worker/src/services/youtube/client.ts`

**Changes:**
- Implement `initializeUpload()`: POST to `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
- Implement `uploadFile()`: PUT to resumable upload URL
- Implement `makeRequest()`: HTTP client with error handling
- Update `uploadShort()`: Call real methods instead of returning stub
- Add timeout handling (10 minutes default)
- Add error parsing and `YouTubeApiError` throwing

**Dependencies:** T1-2a (error types must exist first)

**Risks:** Medium (external API integration, network failures)

**Rollback:** Revert to stub (or feature flag to switch between stub/real)

**Tests:** Add unit tests for client (happy path, error cases)

**Feature flag (optional):**
- Add `YOUTUBE_USE_REAL_API` env var (default: `true`)
- If `false`, return stub (for testing)
- Remove feature flag after E2E tests pass (T1-2f)

---

### T1-2c — Add Input Validation & Sanitization

**Goal:** Validate inputs before API calls to avoid 400 errors.

**Files to change:**
- `apps/worker/src/services/youtube/client.ts`

**Changes:**
- Validate `title` length (max 100 chars, truncate if needed)
- Validate `description` length (max 5000 chars, truncate if needed)
- Validate `tags` (max 10 tags, max 30 chars each, max 500 chars total, trim/sanitize)
- Validate `visibility` (must be 'public' | 'unlisted' | 'private')
- Validate file exists and is readable before upload

**Dependencies:** T1-2b (validation happens before API calls)

**Risks:** Low (input validation, defensive programming)

**Rollback:** Remove validation (API will return 400, but at least we tried)

**Tests:** Add unit tests for validation (long title, many tags, invalid visibility)

---

### T1-2d — Add Unit Tests for YouTube Client

**Goal:** Comprehensive unit test coverage for client.

**Files to change:**
- `test/services/youtube/client.test.ts` (create new)

**Changes:**
- Mock `fetch` globally
- Mock `readFile` from `node:fs/promises`
- Test happy path (successful upload)
- Test error cases (400, 401, 403, 429, 5xx, timeout, network error)
- Test input validation (T1-2c)
- Assert error `retryable` flags are correct

**Dependencies:** T1-2b, T1-2c (tests cover implemented functionality)

**Risks:** Low (tests only)

**Rollback:** Delete test file (no runtime impact)

**Tests:** Run `test:core` to verify all tests pass

---

### T1-2e — Add Integration Tests for Pipeline + Client

**Goal:** Test pipeline integration with mocked YouTube client.

**Files to change:**
- `test/pipelines/publish-youtube.integration.test.ts` (create new)

**Changes:**
- Mock YouTube client (or mock `fetch` at module level)
- Use test Supabase instance (or mocked Supabase client)
- Test full pipeline flow: clip → upload → DB updates
- Test error handling: quota error → job fails, clip not updated
- Test idempotency: second run with existing `external_id` → skip upload

**Dependencies:** T1-2b, T1-2d (pipeline uses real client, tests verify integration)

**Risks:** Low (tests only, mocked dependencies)

**Rollback:** Delete test file (no runtime impact)

**Tests:** Run `test:core` to verify all tests pass

---

### T1-2f — Remove Stub Code & Finalize Logging

**Goal:** Clean up stub code, finalize logging, remove feature flags.

**Files to change:**
- `apps/worker/src/services/youtube/client.ts`
- `apps/worker/src/pipelines/publish-youtube.ts` (logging enhancements)

**Changes:**
- Remove stub implementation (if feature flag exists, remove it)
- Remove `dryrun_` prefix logic (no longer needed)
- Add structured logging in client: `youtube_upload_success`, `youtube_upload_failed`
- Enhance pipeline logging: add `fileSize`, `uploadDurationMs` to success logs
- Add quota error detection: log `quota_exceeded: true` for quota errors

**Dependencies:** T1-2b, T1-2d, T1-2e (all functionality tested, ready for production)

**Risks:** Low (cleanup only, behavior unchanged)

**Rollback:** Re-add feature flag, restore stub code

**Tests:** Run `test:core`, verify E2E test passes (if available)

---

### T1-2g — Update Documentation & Runbook (Optional, can be deferred)

**Goal:** Document YouTube client in ops runbook.

**Files to change:**
- `REPORTS/backend_ops_runbook.md` (or similar)

**Changes:**
- Add "YouTube Publishing Troubleshooting" section
- Document common errors: quota exceeded, invalid metadata, token refresh failures
- Document how to check YouTube API quota usage
- Document how to verify OAuth tokens are valid

**Dependencies:** T1-2f (production-ready, can document real behavior)

**Risks:** None (documentation only)

**Rollback:** Remove documentation section

**Tests:** Documentation review

---

## 8. Open Questions & Assumptions

### 8.1 Scheduling

**Question:** Will we handle scheduling via YouTube API (`publishAt` field) or internally (our job queue)?

**Assumption for MVP:** Internal scheduling only (existing `schedules` table + cron job).

**Rationale:**
- Simpler implementation (no YouTube API scheduling needed)
- More control (we can retry, update, cancel)
- YouTube `publishAt` requires additional API complexity (polling, timezone handling)

**Future enhancement:** Add YouTube API scheduling if needed (use `status.publishAt` field in upload request).

---

### 8.2 Quota Limits

**Question:** What are our YouTube API quota limits, and how do we monitor/guard against quota exhaustion?

**Assumption for MVP:** Rely on YouTube default quota (10,000 units/day per project).

**Quota calculation:**
- Video upload = 1600 units
- Max uploads/day = 10,000 / 1600 = ~6 uploads/day per project (if only uploading)
- Multiple projects can share quota (project = Google Cloud project = OAuth app)

**Monitoring:**
- Log quota errors with `quotaExceeded: true`
- Alert on quota errors (future: Sentry alert)
- Manual monitoring: Google Cloud Console → YouTube Data API → Quotas

**Future enhancement:** Add quota tracking/guarding (track daily usage, prevent uploads if quota low).

---

### 8.3 File Size Limits

**Question:** What is the maximum file size for YouTube Shorts, and should we validate before upload?

**Assumption for MVP:** YouTube allows up to 256GB, but Shorts are typically < 100MB.

**Validation:**
- Don't add file size validation in MVP (YouTube API will reject with 413 if too large)
- Future: Add validation before upload to avoid wasted API quota

**File format:**
- We ensure MP4 format (from clip render pipeline)
- YouTube accepts MP4, MOV, AVI, etc. (MP4 is recommended)

---

### 8.4 Metadata Requirements

**Question:** Are there required metadata fields for YouTube Shorts (title, description, tags)?

**Assumption for MVP:** 
- Title: Required (can be empty string, but YouTube may reject)
- Description: Optional (can be empty)
- Tags: Optional (can be empty array)
- Category: We'll use "22" (People & Blogs) or "24" (Entertainment) — hard-code for MVP

**Future enhancement:** Make category configurable, or detect from tags/description.

---

### 8.5 Multi-Account Support

**Question:** How do we handle multiple YouTube accounts per workspace?

**Assumption for MVP:** Existing multi-account support works (via `connectedAccountId` in job payload).

**Current behavior:**
- Pipeline accepts `connectedAccountId` in payload
- Each upload uses that account's token (from `connected_accounts` table)
- Multiple accounts can upload simultaneously (different jobs)

**No changes needed:** Multi-account support already exists in pipeline.

---

### 8.6 Error Recovery

**Question:** Should we implement resumable upload resume (for interrupted uploads)?

**Assumption for MVP:** No resume — always start fresh upload on retry.

**Rationale:**
- Simpler implementation (no session tracking)
- Shorts files are small (< 100MB typically)
- Worker retry will re-upload (acceptable for small files)
- YouTube API quota cost is same (resume or fresh upload both cost 1600 units)

**Future enhancement:** Implement resume for large files (track upload session URL, resume on retry).

---

## Summary

This implementation plan provides a detailed roadmap for replacing the stubbed YouTube client with a real YouTube Data API v3 integration. The plan:

- ✅ Maintains backward compatibility (same interface, no pipeline changes)
- ✅ Follows existing patterns (TikTok client as reference)
- ✅ Includes comprehensive error handling and logging
- ✅ Breaks work into small, safe substeps (T1-2a through T1-2g)
- ✅ Addresses security, testing, and operational concerns
- ✅ Documents open questions and assumptions

**Next steps:** Begin with T1-2a (error types & structure), then proceed through T1-2b (real API), T1-2c (validation), T1-2d (unit tests), T1-2e (integration tests), and T1-2f (cleanup).

**Dependencies:** 
- T1-2a → T1-2b → T1-2c → T1-2d → T1-2e → T1-2f (sequential)
- T1-2g (documentation) can be done in parallel or deferred

**Estimated timeline:** 3-5 days for T1-2a through T1-2f (assuming full-time focus).

---

**End of Implementation Plan**

