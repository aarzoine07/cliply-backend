# T1 Audit Report v2

**Timestamp:** 2025-12-16  
**Branch:** `engine-surface-setup`  
**Purpose:** Consolidated audit report providing foundational context for Track T1 — YouTube Publishing & OAuth Completion

---

## 1. Repo Snapshot

### Baseline Information

```
Repository Path: /Users/davidmaman/Desktop/cliply-backend
Current Branch: engine-surface-setup
Git Status: Clean working tree (no uncommitted changes)
Node Version: v22.20.0
pnpm Version: 10.24.0
```

### Directory Structure

```
apps/
  web/          - Next.js API routes (Pages Router), auth, publish endpoints
  worker/       - Pipeline internals, job execution (not owned for T1)
packages/
  shared/       - Shared services, env, constants, schemas, auth context
supabase/
  migrations/   - Database schema, RLS policies, migrations
test/
  api/          - API route tests (include YouTube OAuth/publish tests)
  worker/       - Worker pipeline tests (not owned for T1)
  utils/        - Test utilities (supertest-next.ts)
REPORTS/        - Documentation, audit reports, runbooks
scripts/        - Utility scripts, readiness checks
docs/           - Product documentation
```

**Evidence:** `ls -la` output, project structure inspection

---

## 2. Cliply Overview

### Product Summary

**Cliply** is a multi-tenant SaaS platform that:
- Processes long-form videos (upload or YouTube import) into short-form clips
- Uses AI to detect highlights and generate clips automatically
- Allows scheduling and publishing clips to TikTok and YouTube Shorts
- Supports workspaces with multiple members and multiple connected social accounts per workspace

### Core Concepts

1. **Workspaces** (Multi-tenant isolation)
   - Each workspace has `owner_id` and optional `org_id`
   - Users belong to workspaces via `workspace_members` table
   - All content (projects, clips, accounts) is workspace-scoped

2. **Projects → Clips → Schedules/Publish**
   - Projects: Source videos (file upload or YouTube URL)
   - Clips: Generated short-form clips from projects
   - Schedules: Scheduled publishing times
   - Publishing: Posts clips to connected TikTok/YouTube accounts

3. **Connected Accounts Model**
   - OAuth-connected social media accounts (TikTok, YouTube)
   - Stored in `connected_accounts` table
   - Scoped to workspace (`workspace_id`) and user (`user_id`)
   - Multiple accounts per workspace supported (per platform)

4. **Publishing Flow**
   - User approves clips → clips rendered → clips published to connected accounts
   - Publishing enqueues jobs → worker processes jobs → updates clip status
   - Supports multi-account publishing (one job per account per clip)

### Evidence Sources

- **REPORTS/onboarding_journey_2025-12-11.md** (lines 1-177): Complete user onboarding flow
- **REPORTS/backend_build_tracks_cliply.md** (lines 64-109): Track T1 scope definition
- **REPORTS/backend_delta_to_done_cliply.md** (lines 71-227): Capability A (Multi-tenant) details
- **db/schema.sql** (lines 6-79): Core schema (workspaces, projects, clips, connected_accounts)

---

## 3. Backend Architecture Map

### apps/web (API Surface)

**Location:** `apps/web/src/pages/api/`

**Key Responsibilities:**
- Authentication/authorization via `buildAuthContext()` from `@cliply/shared/auth/context`
- Workspace-scoped API routes
- OAuth flows (TikTok, YouTube)
- Publishing endpoints (`/api/publish/youtube.ts`, `/api/publish/tiktok.ts`)
- Upload, clip management, billing, accounts management

**Auth Model:**
- Uses `buildAuthContext()` which supports:
  - Production: JWT tokens from Authorization header or cookies
  - Test/Dev: `x-debug-user` and `x-debug-workspace` headers
- Workspace ID extracted from `x-workspace-id` header (validated by middleware)
- RLS client created from access token for workspace-scoped queries

**Evidence:**
- `apps/web/src/lib/auth/context.ts` (lines 97-206): Auth context builder
- `apps/web/src/pages/api/publish/youtube.ts` (lines 28-40): Auth usage in publish route
- `packages/shared/src/auth/context.ts` (lines 112-206): Shared auth context implementation

### apps/worker (Pipeline Internals)

**Location:** `apps/worker/src/pipelines/`

**Key Responsibilities:**
- Job execution (transcribe, highlight detection, clip rendering, publishing)
- YouTube publish pipeline: `apps/worker/src/pipelines/publish-youtube.ts`
- Uses `YouTubeClient` from `apps/worker/src/services/youtube/client.ts`

**Not Owned for T1:** Worker internals, job lifecycle, DLQ, pipeline checkpoints (ER-01..ER-06)

**Evidence:**
- `apps/worker/src/pipelines/publish-youtube.ts` (lines 40-333): YouTube publish pipeline
- `REPORTS/backend_build_tracks_cliply.md` (line 89): Worker internals out of scope

### packages/shared (Shared Services)

**Location:** `packages/shared/src/`

**Key Modules:**
- `env/` - Environment variable management (`getEnv()`)
- `auth/context.ts` - Auth context builder (shared between web and worker)
- `services/youtubeAuth.ts` - YouTube OAuth token management
- `schemas/` - Zod schemas for API validation
- `billing/` - Plan resolution, usage tracking
- `types/auth.ts` - Auth type definitions

**Evidence:**
- `packages/shared/src/services/youtubeAuth.ts` (lines 1-311): YouTube OAuth implementation
- `packages/shared/src/auth/context.ts` (lines 112-206): Shared auth context

### supabase (Schema/Migrations/RLS)

**Location:** `supabase/migrations/`

**Key Tables for T1:**
- `connected_accounts` - OAuth-connected accounts
- `clips` - Generated clips
- `jobs` - Background job queue
- `variant_posts` - Track published posts (for viral experiments)

**RLS Policies:**
- `connected_accounts`: `connected_accounts_workspace_member_read`, `connected_accounts_workspace_member_modify`
- All tables have workspace-scoped access via `is_workspace_member()` helper

**Evidence:**
- `supabase/migrations/20251123015000_connected_accounts_base.sql` (lines 1-74): Connected accounts schema
- `supabase/migrations/20251213195500_rls_connected_accounts_workspace_scoped.sql` (lines 1-34): RLS policies

### test (Test Patterns)

**Location:** `test/api/`

**Test Structure:**
- API route tests use `supertestHandler` from `test/utils/supertest-next.ts`
- Tests use `x-debug-user` and `x-debug-workspace` headers for auth
- Tests mock Supabase client via `getAdminClient()` and `getRlsClient()` spies

**Evidence:**
- `test/api/publish.youtube.test.ts` (lines 1-388): YouTube publish endpoint tests
- `test/api/accounts.youtube-auth.test.ts` (lines 1-129): YouTube OAuth tests
- `test/utils/supertest-next.ts`: Test utility wrapper

---

## 4. Auth + Workspace Scoping Model

### Authentication Flow

**Production Path:**
1. Client sends request with `Authorization: Bearer <jwt>` header OR cookies containing Supabase session
2. `buildAuthContext()` extracts access token from header or cookies
3. Token validated via Supabase Auth API
4. User ID extracted from token claims
5. Workspace ID extracted from `x-workspace-id` header (validated for UUID format)

**Test/Dev Path:**
1. Request includes `x-debug-user` and `x-debug-workspace` headers
2. `buildAuthContext()` validates UUIDs and creates test JWT if needed
3. Workspace membership validated via `is_workspace_member()` RPC call (if using RLS client)

**Evidence:**
- `packages/shared/src/auth/context.ts` (lines 79-150): Token extraction and validation
- `apps/web/src/lib/auth/context.ts` (lines 69-81): Test JWT minting for RLS
- `apps/web/src/middleware/validateWorkspaceHeader.ts` (lines 89-141): Workspace header validation

### Workspace Scoping

**How workspace_id is derived:**
- Header: `x-workspace-id` (required, validated as UUID)
- Auth context: `auth.workspaceId` or `auth.workspace_id`
- Database queries: RLS policies enforce workspace scoping via `is_workspace_member(workspace_id)`

**Workspace Membership Validation:**
- RLS policies use `is_workspace_member()` helper function
- Function checks `workspace_members` table for user-workspace association
- Service role bypasses RLS for admin operations

**Evidence:**
- `supabase/migrations/20251201010000_fix_workspace_membership_helper.sql` (lines 31-42): `is_workspace_member()` helper
- `apps/web/src/pages/api/publish/youtube.ts` (lines 112-169): Workspace validation in publish route

### RLS Client vs Admin Client

**RLS Client (`getRlsClient(accessToken)`):**
- Respects Row Level Security policies
- Used for user-initiated operations (clip lookup, account queries)
- Requires valid access token

**Admin Client (`getAdminClient()`):**
- Bypasses RLS (service_role)
- Used for job insertion, admin operations
- Should only be used when RLS would block necessary operations

**Evidence:**
- `apps/web/src/pages/api/publish/youtube.ts` (lines 110-141): RLS client for clip lookup, admin client for job insertion
- `apps/web/src/lib/supabase.ts`: Client factory functions

---

## 5. YouTube OAuth Surface

### OAuth Start Endpoint

**Route:** `GET /api/oauth/google/start`

**File:** `apps/web/src/pages/api/oauth/google/start.ts` (lines 1-92)

**Inputs:**
- Headers: `Authorization` (JWT) or `x-debug-user` + `x-debug-workspace`
- Query params: `redirect_uri` (optional, validated against env)

**Workspace/User Resolution:**
- Uses `buildAuthContext(req)` → extracts `userId` and `workspaceId`
- Requires both `userId` and `workspaceId` (returns 401 if missing)

**State Construction:**
```typescript
const state = Buffer.from(
  JSON.stringify({
    workspaceId: params.workspaceId,
    userId: params.userId,
  }),
).toString("base64url");
```
- Base64url-encoded JSON with workspace_id and user_id
- **No PKCE implementation** (no code_verifier/code_challenge)
- **No anti-CSRF nonce** (relies on state containing workspace/user)

**Redirect URL Construction:**
- Uses `YOUTUBE_OAUTH_REDIRECT_URL` from env (required)
- Validates requested `redirect_uri` matches configured value
- Builds Google OAuth URL via `buildYouTubeAuthUrl()` from `@cliply/shared/services/youtubeAuth`

**OAuth URL Parameters:**
- `client_id`: `GOOGLE_CLIENT_ID`
- `redirect_uri`: `YOUTUBE_OAUTH_REDIRECT_URL`
- `scope`: `https://www.googleapis.com/auth/youtube.upload`
- `access_type`: `offline` (to get refresh token)
- `prompt`: `consent` (force consent screen)
- `state`: Base64url-encoded workspace/user info

**Evidence:**
- `apps/web/src/pages/api/oauth/google/start.ts` (lines 12-73): Full start endpoint implementation
- `packages/shared/src/services/youtubeAuth.ts` (lines 32-69): `buildYouTubeAuthUrl()` function

### OAuth Callback Endpoint

**Route:** `GET /api/oauth/google/callback`

**File:** `apps/web/src/pages/api/oauth/google/callback.ts` (lines 1-136)

**⚠️ CRITICAL NOTE:** File header states: `// DEV-ONLY — Legacy OAuth route. Do NOT use in production.`

**Inputs:**
- Query params: `code` (authorization code), `state` (workspace/user), `error` (OAuth error)

**State Decoding:**
```typescript
const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
workspaceId = decoded.workspaceId;
userId = decoded.userId;
```
- Decodes base64url state to get workspace_id and user_id
- Returns 400 if state is invalid

**Token Exchange:**
- Calls `completeYouTubeOAuthFlow()` from `@/lib/accounts/youtubeOauthService`
- Exchanges code for tokens via `exchangeYouTubeCodeForTokens()`
- Fetches channel info via `fetchYouTubeChannelForToken()`
- Stores account via `createOrUpdateConnectedAccount()`

**Token Storage:**
- Tokens stored in `connected_accounts` table:
  - `access_token_encrypted_ref`: Access token (currently stored as plaintext, needs encryption)
  - `refresh_token_encrypted_ref`: Refresh token (currently stored as plaintext)
  - `expires_at`: Token expiration timestamp
  - `scopes`: Array of granted scopes

**Error Handling:**
- Google OAuth errors: Returns 400 with `oauth_error` code
- Missing code/state: Returns 400 with `invalid_request`
- Token exchange failures: Returns 500 with `internal_error`
- Config errors: Returns 500 with "OAuth redirect URI not configured"

**Error Response Shape:**
```typescript
{
  ok: false,
  code: "oauth_error" | "invalid_request" | "internal_error",
  message: string
}
```

**Evidence:**
- `apps/web/src/pages/api/oauth/google/callback.ts` (lines 27-134): Full callback implementation
- `apps/web/src/lib/accounts/youtubeOauthService.ts` (lines 30-73): `completeYouTubeOAuthFlow()` function
- `packages/shared/src/services/youtubeAuth.ts` (lines 75-133): Token exchange implementation

### Multi-Account Linking Behavior

**Current Implementation:**
- Uses `createOrUpdateConnectedAccount()` from `connectedAccountsService`
- **Upsert logic:** Checks for existing account by `(workspace_id, platform)`
- **Schema constraint:** `connected_accounts_workspace_platform_key UNIQUE (workspace_id, platform)`

**Implication:**
- **Only ONE YouTube account per workspace is supported** (blocked by unique constraint)
- If user connects a second YouTube account, it will UPDATE the existing account (not create a new one)

**Account Upsert Flow:**
```typescript
// Check for existing account by (workspace_id, platform)
const { data: existing } = await ctx.supabase
  .from("connected_accounts")
  .select("*")
  .eq("workspace_id", workspaceId)
  .eq("platform", parsed.platform)
  .maybeSingle();

if (existing) {
  // Update existing account
  await ctx.supabase.from("connected_accounts").update(accountData).eq("id", existing.id);
} else {
  // Create new account
  await ctx.supabase.from("connected_accounts").insert(accountData);
}
```

**Evidence:**
- `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 64-175): Upsert implementation
- `supabase/migrations/20251123015000_connected_accounts_base.sql` (lines 44-50): Unique constraint
- Database schema query output: `connected_accounts_workspace_platform_key UNIQUE (workspace_id, platform)`

---

## 6. Connected Accounts Schema Reality

### Schema Definition

**Table:** `public.connected_accounts`

**Key Columns:**
- `id` (uuid, PK)
- `user_id` (uuid, FK → `auth.users(id)`) - **References auth.users, not public.users**
- `workspace_id` (uuid, FK → `workspaces(id)`)
- `provider` (text) - e.g., "google" for YouTube
- `external_id` (text) - Platform account ID (e.g., YouTube channel ID)
- `platform` (text) - "tiktok" or "youtube"
- `access_token_encrypted_ref` (text) - Access token storage (currently plaintext)
- `refresh_token_encrypted_ref` (text) - Refresh token storage (currently plaintext)
- `expires_at` (timestamptz) - Token expiration
- `scopes` (text[]) - Granted OAuth scopes
- `display_name` (text) - Channel/account display name
- `handle` (text) - Account handle (e.g., @channel)
- `status` (text) - "active", "revoked", or "error" (CHECK constraint)
- `created_at`, `updated_at` (timestamptz)

### Constraints

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE
- `workspace_id` → `workspaces(id)` ON DELETE CASCADE

**Unique Constraints:**
1. `connected_accounts_provider_external_id_key`: UNIQUE (provider, external_id)
   - Prevents duplicate accounts across workspaces (same Google account can only be connected once globally)

2. `connected_accounts_workspace_platform_key`: UNIQUE (workspace_id, platform)
   - **BLOCKS MULTI-ACCOUNT PER PLATFORM PER WORKSPACE**
   - Only one YouTube account per workspace allowed

**Check Constraints:**
- `platform` IN ('tiktok', 'youtube')
- `status` IN ('active', 'revoked', 'error')

### Status States

**Active States:**
- `active`: Account is usable for publishing
- `revoked`: User revoked access (tokens invalid)
- `error`: Token refresh failed or API error

**Publish Interpretation:**
- `getConnectedAccountsForPublish()` filters by `status = 'active'`
- Accounts with `revoked` or `error` status are excluded from publishing

**Evidence:**
- Database schema query: `\d+ public.connected_accounts` output (see Repo Snapshot section)
- `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 257, 302): Status filtering in queries
- `supabase/migrations/20251123015000_connected_accounts_base.sql` (lines 6-50): Schema definition

### RLS Policies

**Policies:**
1. `connected_accounts_workspace_member_read` (SELECT)
   - Allows workspace members to read accounts for their workspace
   - Uses `is_workspace_member(workspace_id)` helper

2. `connected_accounts_workspace_member_modify` (INSERT/UPDATE/DELETE)
   - Allows workspace members to modify accounts for their workspace
   - Uses `is_workspace_member(workspace_id)` helper

3. `connected_accounts_service_role_full_access`
   - Service role bypasses RLS for admin operations

**Evidence:**
- `supabase/migrations/20251213195500_rls_connected_accounts_workspace_scoped.sql` (lines 1-34): RLS policies
- Database schema query output shows policies

---

## 7. YouTube Publish Surface Wiring

### Publish Endpoint

**Route:** `POST /api/publish/youtube`

**File:** `apps/web/src/pages/api/publish/youtube.ts` (lines 1-349)

**Input Payload:**
```typescript
{
  clipId: string;
  connectedAccountIds?: string[];  // Optional, defaults to all active accounts
  scheduleAt?: string | null;      // ISO datetime
  visibility?: "public" | "unlisted" | "private";  // Default: "public"
  titleOverride?: string | null;
  descriptionOverride?: string | null;
  experimentId?: string | null;    // Viral experiment ID
  variantId?: string | null;       // Experiment variant ID
}
```

### Call Chain

**1. Auth Context:**
```typescript
auth = await buildAuthContext(req);
userId = auth.userId || auth.user_id;
workspaceId = auth.workspaceId || auth.workspace_id;
```

**2. Plan Gating:**
- Checks `checkPlanAccess(auth.plan, 'concurrent_jobs')`
- Returns 403/429 if plan doesn't allow publishing

**3. Rate Limiting:**
- `checkRateLimit(userId, 'publish:youtube')`
- Disabled in test environment

**4. Workspace Resolution:**
- Workspace ID from auth context (required)
- Validates workspace_id is present

**5. Clip Lookup (RLS Client):**
```typescript
const clipRecord = await rls
  .from('clips')
  .select('workspace_id,status,render_path')
  .eq('id', parsed.data.clipId)
  .maybeSingle();
```
- Uses RLS client to respect workspace scoping
- Verifies clip belongs to workspace (returns 403 if mismatch)
- Checks clip status: must be 'ready', cannot be 'published'

**6. Connected Account Resolution:**
```typescript
const accounts = await connectedAccountsService.getConnectedAccountsForPublish({
  workspaceId,
  platform: 'youtube',
  connectedAccountIds: parsed.data.connectedAccountIds,
}, { supabase: rls });
```
- If `connectedAccountIds` provided: validates all IDs belong to workspace and are active
- If not provided: returns all active YouTube accounts for workspace
- Returns 400 if no active accounts found

**7. Job Enqueueing (Admin Client):**
```typescript
const jobsPayload = resolvedAccountIds.map((accountId) => ({
  workspace_id: workspaceId,
  type: 'publish_youtube',
  status: 'pending',
  payload: {
    clipId: parsed.data.clipId,
    visibility: parsed.data.visibility,
    scheduleAt: parsed.data.scheduleAt ?? null,
    connectedAccountId: accountId,
    experimentId: parsed.data.experimentId ?? null,
    variantId: parsed.data.variantId ?? null,
  },
  created_by: userId,
}));

const { data, error } = await admin
  .from('jobs')
  .insert(jobsPayload)
  .select();
```
- Creates one job per connected account
- Uses admin client to bypass RLS for job insertion
- Returns job IDs to client

**8. Response:**
```typescript
{
  ok: true,
  data: {
    jobIds: string[],
    accountCount: number
  }
}
```

### Cross-Workspace Prevention

**Checks:**
1. Clip workspace validation (line 165-169):
   ```typescript
   if (!clipWorkspaceId || clipWorkspaceId !== workspaceId) {
     res.status(403).json(err('invalid_request', 'Clip does not belong to workspace'));
   }
   ```

2. Connected account validation (line 202-209):
   - `getConnectedAccountsForPublish()` queries with `workspace_id` filter
   - Only returns accounts that belong to the requested workspace

3. RLS enforcement:
   - Clip lookup uses RLS client → RLS policies prevent cross-workspace access
   - Connected account queries use RLS client → workspace membership enforced

**Evidence:**
- `apps/web/src/pages/api/publish/youtube.ts` (lines 144-243): Full publish implementation
- `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 238-330): Account resolution with workspace validation

### DB Tables for Publish Status

**Tables Involved:**
1. **`jobs`** - Job queue
   - Columns: `id`, `workspace_id`, `kind`, `state` ('queued', 'running', 'done', 'error'), `payload` (JSONB)
   - Publish jobs: `kind = 'publish_youtube'`, `payload.clipId`, `payload.connectedAccountId`

2. **`clips`** - Clip status tracking
   - Columns: `id`, `workspace_id`, `status`, `external_id` (platform video ID), `published_at`
   - Status updated to 'published' after successful publish

3. **`variant_posts`** - Viral experiment post tracking (optional)
   - Columns: `id`, `clip_id`, `connected_account_id`, `platform`, `status`, `platform_post_id`
   - Used when `experimentId` and `variantId` provided

**Status Update Flow:**
1. Surface endpoint: Creates jobs in 'pending' state
2. Worker: Processes job, uploads to YouTube
3. Worker: Updates `clips.status = 'published'`, `clips.external_id = videoId`
4. Worker: Updates `variant_posts.status = 'posted'` (if experiment involved)

**Evidence:**
- `apps/worker/src/pipelines/publish-youtube.ts` (lines 210-219): Clip status update
- `apps/worker/src/pipelines/publish-youtube.ts` (lines 221-242): Variant post update
- `apps/web/src/pages/api/publish/youtube.ts` (lines 292-321): Job creation

---

## 8. Guardrails & RLS Bypass Findings

### Admin Client Usage in T1 Routes

**Files Using `getAdminClient()`:**

1. **`apps/web/src/pages/api/oauth/google/callback.ts`** (line 73)
   - **Usage:** OAuth callback token exchange
   - **Rationale:** Callback endpoint called by Google (no user session), needs service role to upsert connected account
   - **Risk Level:** ⚠️ **MEDIUM** - Needs workspace_id validation from state param (done)

2. **`apps/web/src/pages/api/publish/youtube.ts`** (line 110)
   - **Usage:** Job insertion into `jobs` table
   - **Rationale:** Jobs table may have RLS that blocks inserts, or jobs are workspace-scoped but inserted by service role
   - **Risk Level:** ✅ **SAFE** - Workspace_id included in job payload, workspace validated earlier

**Files NOT Using Admin Client (Using RLS):**

1. **`apps/web/src/pages/api/oauth/google/start.ts`**
   - No database queries (only builds OAuth URL)

2. **`apps/web/src/pages/api/publish/youtube.ts`**
   - Clip lookup: Uses RLS client (lines 146-150)
   - Connected account lookup: Uses RLS client (line 208)

### Direct Table Access Bypass Check

**Connected Accounts Access:**
- OAuth callback: Uses admin client but validates workspace from state → then uses `createOrUpdateConnectedAccount()` which should use the provided supabase client (admin)
- Publish endpoint: Uses RLS client for account queries

**Clips Access:**
- Publish endpoint: Uses RLS client (line 146)
- Workspace validation done manually (line 165-169) as additional guard

**Jobs Access:**
- Publish endpoint: Uses admin client (line 308)
- Jobs are workspace-scoped via `workspace_id` column in payload

**Findings:**
- ✅ OAuth callback correctly extracts workspace from state before upserting account
- ✅ Publish endpoint uses RLS for user-accessible data (clips, accounts)
- ✅ Jobs insertion uses admin client but includes workspace_id in payload
- ⚠️ **Recommendation:** Verify jobs table RLS allows workspace member inserts (if not, admin client usage is justified)

**Evidence:**
- `apps/web/src/pages/api/oauth/google/callback.ts` (lines 52-61, 73-83): Workspace validation from state
- `apps/web/src/pages/api/publish/youtube.ts` (lines 110-141, 146-169): RLS vs admin client usage
- `grep` search results: 22 files use `getAdminClient` (many are non-T1 routes)

---

## 9. Tests: Existing + Missing

### Existing Tests

#### OAuth Tests

**File:** `test/api/accounts.youtube-auth.test.ts` (lines 1-129)

**Coverage:**
- ✅ OAuth start: Returns 401 without session, returns OAuth URL when configured, returns 500 when not configured
- ✅ OAuth callback: Returns 400 when code/state missing, handles OAuth error parameter
- ❌ **Missing:** Full OAuth flow test (start → callback with mocked Google responses)
- ❌ **Missing:** Token exchange error handling tests (invalid_grant, revoked tokens)
- ❌ **Missing:** Multi-account linking test (though schema constraint blocks this)

**Test Auth Setup:**
- Uses `x-debug-user` and `x-debug-workspace` headers
- Mocks environment variables for OAuth config

#### Publish Tests

**File:** `test/api/publish.youtube.test.ts` (lines 1-388)

**Coverage:**
- ✅ Returns 401 without session
- ✅ Returns 400 for invalid payload
- ✅ Returns 404 when clip not found
- ✅ Enqueues single job for single account
- ✅ Enqueues multiple jobs for multiple accounts
- ✅ Creates variant_posts when experimentId/variantId provided
- ✅ Uses default accounts when connectedAccountIds not provided
- ❌ **Missing:** Cross-workspace clip access test (403 expected)
- ❌ **Missing:** Disabled account test (400 expected)
- ❌ **Missing:** No active accounts test (400 expected)
- ❌ **Missing:** Clip status validation tests (must be 'ready', cannot be 'published')

**Test Fixtures:**
- Mock clip: `{ id, workspace_id, status: 'ready', storage_path }`
- Mock accounts: Array of connected account objects
- Mock Supabase clients: `createAdminClient()` helper mocks DB responses

#### Account Tests

**File:** `test/api/accounts.test.ts` (lines 1-166)

**Coverage:**
- ✅ Lists connected accounts for workspace
- ✅ Filters by platform
- ✅ Creates new connected account
- ✅ Returns 400 for invalid payload
- ❌ **Missing:** Cross-workspace account access test
- ❌ **Missing:** Account status update tests (active → revoked → error)

**Test Helpers:**
- `TEST_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'`
- `TEST_USER_ID = '00000000-0000-0000-0000-000000000001'`
- `supertestHandler()` wrapper for Next.js API routes

### Missing Tests

#### 1. OAuth Start Test - Full Flow

**File:** `test/api/oauth.google.start.test.ts` (NEW)

**What it proves:**
- OAuth URL contains correct parameters (client_id, scope, state)
- State encodes workspace_id and user_id correctly
- Redirect URI validation works

**Endpoint:** `GET /api/oauth/google/start`

**Required Fixtures:**
- Mock env vars: `GOOGLE_CLIENT_ID`, `YOUTUBE_OAUTH_REDIRECT_URL`
- Test user ID and workspace ID

#### 2. OAuth Callback Test - Token Exchange

**File:** `test/api/oauth.google.callback.test.ts` (NEW)

**What it proves:**
- Token exchange succeeds with valid code
- Connected account is created/updated correctly
- Channel info is fetched and stored
- Error handling for invalid code, expired code, revoked tokens

**Endpoint:** `GET /api/oauth/google/callback`

**Required Fixtures:**
- Mock Google token exchange API response
- Mock Google channel API response
- Mock Supabase client for account upsert
- Valid base64url-encoded state with workspace/user IDs

**Test Cases:**
- ✅ Success: Code → tokens → channel → account created
- ❌ Invalid code: Returns 400/500
- ❌ Expired code: Returns error
- ❌ Revoked tokens: Handles gracefully
- ❌ Invalid state: Returns 400

#### 3. Connected Account Scoping Test

**File:** `test/api/accounts.scoping.test.ts` (NEW)

**What it proves:**
- Accounts from workspace A cannot be accessed by workspace B user
- `getConnectedAccountsForPublish()` respects workspace boundaries
- Cross-workspace account IDs are rejected

**Required Fixtures:**
- Two workspaces: `workspaceA`, `workspaceB`
- Two users: `userA` (member of workspaceA), `userB` (member of workspaceB)
- Accounts: `accountA` (workspaceA), `accountB` (workspaceB)

**Test Cases:**
- ✅ UserA can list accounts for workspaceA
- ❌ UserA cannot list accounts for workspaceB (403 or empty result)
- ❌ UserA cannot publish with accountB (400: account not found)

#### 4. Publish-to-YouTube API Test - Negative Cases

**File:** `test/api/publish.youtube.negative.test.ts` (NEW)

**What it proves:**
- Cross-workspace clip access is blocked (403)
- Disabled account is rejected (400)
- No active accounts returns error (400)
- Clip status validation works (must be 'ready', cannot be 'published')

**Endpoint:** `POST /api/publish/youtube`

**Required Fixtures:**
- Clip in workspaceA (status: 'ready')
- Clip in workspaceB (status: 'ready')
- Clip in workspaceA (status: 'published')
- Active YouTube account in workspaceA
- Disabled YouTube account in workspaceA (status: 'revoked')
- Workspace-scoped RLS client mocks

**Test Cases:**
- ❌ User from workspaceA tries to publish clip from workspaceB → 403
- ❌ Publish with disabled account → 400 (account not found/inactive)
- ❌ Publish when no active accounts exist → 400
- ❌ Publish clip with status 'published' → 400 (already published)
- ❌ Publish clip with status 'proposed' → 400 (not ready)

#### 5. E2E Test - Full YouTube Publishing Flow

**File:** `test/api/publish.youtube.e2e.test.ts` (NEW)

**What it proves:**
- Complete flow: OAuth start → OAuth callback → account created → publish → job enqueued → (optional) worker processes job
- End-to-end integration without mocking worker

**Required Fixtures:**
- Test workspace, user, project, clip (status: 'ready')
- Mock Google OAuth responses (or test with sandbox account)
- Real Supabase connection (test database)
- Optional: Mock YouTube upload API (or use test mode)

**Test Flow:**
1. Start OAuth flow → get OAuth URL
2. Simulate callback with mock Google response → account created
3. Publish clip → job enqueued
4. Verify job in database
5. (Optional) Process job → verify clip status updated

**Evidence:**
- `test/api/accounts.youtube-auth.test.ts`: Existing OAuth tests (incomplete)
- `test/api/publish.youtube.test.ts`: Existing publish tests (missing negative cases)
- `test/api/accounts.test.ts`: Existing account tests (missing scoping tests)

---

## 10. T1 Execution Checklist

### Phase 1: YouTube API Client Implementation (D-01)

**Status:** ✅ Ready to start

**Tasks:**
- [ ] Replace stubbed `uploadShort()` in `apps/worker/src/services/youtube/client.ts`
- [ ] Implement real YouTube Data API v3 upload using `googleapis` library
- [ ] Handle video upload, title, description, tags, visibility parameters
- [ ] Add error handling for YouTube API errors (quota exceeded, invalid token, etc.)
- [ ] Test with sandbox/test YouTube account

**Dependencies:** None (can use test tokens)

**Evidence:**
- `apps/worker/src/services/youtube/client.ts`: Current stubbed implementation (needs replacement)
- `apps/worker/src/pipelines/publish-youtube.ts` (lines 199-206): Client usage in pipeline

### Phase 2: OAuth Callback Verification (D-02)

**Status:** ⚠️ Requires Person 2 verification

**Tasks:**
- [ ] Verify callback endpoint handles all Google OAuth error cases
- [ ] Test token exchange with real Google OAuth (sandbox)
- [ ] Verify account upsert works correctly
- [ ] Add missing error handling (invalid_grant, revoked tokens, expired codes)
- [ ] Remove "DEV-ONLY" comment or clarify production readiness

**Dependencies:** Person 2 to verify callback endpoint exists and works

**Evidence:**
- `apps/web/src/pages/api/oauth/google/callback.ts` (line 1): "DEV-ONLY" comment
- `apps/web/src/pages/api/oauth/google/callback.ts` (lines 32-39): Error handling (basic)

### Phase 3: E2E Test (D-04)

**Status:** ⚠️ Requires D-01 and D-02 complete

**Tasks:**
- [ ] Create E2E test file: `test/api/publish.youtube.e2e.test.ts`
- [ ] Test full flow: OAuth → account creation → publish → job → worker processing
- [ ] Verify clip status updated to 'published'
- [ ] Verify external_id set to YouTube video ID

**Dependencies:** D-01 (real API client), D-02 (working OAuth)

**Evidence:**
- `test/engine/full-pipeline.e2e.test.ts`: Example E2E test structure (TikTok flow)

### Additional Tasks (Not in Original Deltas)

#### Missing Test Coverage

- [ ] Add OAuth callback token exchange tests (negative cases)
- [ ] Add cross-workspace account access tests
- [ ] Add publish endpoint negative tests (disabled account, wrong workspace, invalid clip status)
- [ ] Add multi-account support test (when schema constraint allows)

#### Schema Considerations

- [ ] **CRITICAL:** Review `connected_accounts_workspace_platform_key` unique constraint
  - Current constraint blocks multi-account per platform per workspace
  - If multi-account is required, constraint needs to be removed or changed
  - Evidence: `supabase/migrations/20251123015000_connected_accounts_base.sql` (lines 44-50)

#### Security Hardening

- [ ] Encrypt access tokens and refresh tokens (currently stored as plaintext in `access_token_encrypted_ref`)
- [ ] Add PKCE support to OAuth flow (currently missing)
- [ ] Add CSRF protection to OAuth callback (currently relies on state containing workspace/user)

---

## 11. Explicit Unknowns / Dependencies

### Blocking Unknowns

1. **OAuth Callback Production Readiness**
   - **Unknown:** Is the callback endpoint production-ready despite "DEV-ONLY" comment?
   - **Blocking:** D-02 verification requires Person 2 to test/verify
   - **Evidence:** `apps/web/src/pages/api/oauth/google/callback.ts` (line 1)

2. **Multi-Account Support Intent**
   - **Unknown:** Is multi-account per platform per workspace a requirement?
   - **Current State:** Schema constraint `connected_accounts_workspace_platform_key` blocks multiple YouTube accounts per workspace
   - **Blocking:** If required, schema migration needed before T1 completion
   - **Evidence:** `supabase/migrations/20251123015000_connected_accounts_base.sql` (lines 44-50)

3. **Token Encryption Status**
   - **Unknown:** Are tokens encrypted in production? Column name suggests encryption (`access_token_encrypted_ref`) but code stores plaintext
   - **Blocking:** Security risk if tokens are not encrypted
   - **Evidence:** `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 107-112)

### Dependencies

1. **Google OAuth Credentials**
   - **Required:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_OAUTH_REDIRECT_URL`
   - **Status:** Must be configured in production environment
   - **Evidence:** `packages/shared/src/services/youtubeAuth.ts` (lines 37-42, 79-84)

2. **YouTube Data API v3 Quota**
   - **Required:** Google Cloud project with YouTube Data API v3 enabled
   - **Status:** Must be configured and quota available
   - **Evidence:** `apps/worker/src/services/youtube/client.ts` (needs real API implementation)

3. **Worker Processing**
   - **Dependency:** Worker must process `publish_youtube` jobs (not owned for T1)
   - **Status:** Worker pipeline exists, not verified for production
   - **Evidence:** `apps/worker/src/pipelines/publish-youtube.ts` (exists but may need verification)

### Missing Internal Services

1. **Token Encryption Service**
   - **Status:** Not found in codebase
   - **Requirement:** If tokens must be encrypted, encryption/decryption service needed
   - **Evidence:** Column names suggest encryption but implementation missing

2. **PKCE Implementation**
   - **Status:** Not implemented in YouTube OAuth flow
   - **Requirement:** Google OAuth supports PKCE, should be implemented for security
   - **Evidence:** `packages/shared/src/services/youtubeAuth.ts` (no PKCE code found)

---

## Final Check: Have We Covered ALL T1 Affected Areas?

### Coverage Checklist

- [x] **OAuth Start**
  - ✅ Route identified: `GET /api/oauth/google/start`
  - ✅ Implementation reviewed: `apps/web/src/pages/api/oauth/google/start.ts`
  - ✅ State construction documented (workspace/user encoding, no PKCE)
  - ✅ Redirect URL construction documented
  - ✅ Tests identified (basic coverage exists, full flow missing)

- [x] **OAuth Callback**
  - ✅ Route identified: `GET /api/oauth/google/callback`
  - ✅ Implementation reviewed: `apps/web/src/pages/api/oauth/google/callback.ts`
  - ✅ Token exchange flow documented
  - ✅ Account storage documented (upsert logic)
  - ✅ Error handling documented (basic, needs enhancement)
  - ⚠️ **Missing:** Production readiness verification (marked "DEV-ONLY")

- [x] **Multi-Account Linking + Schema Constraints**
  - ✅ Schema constraint identified: `connected_accounts_workspace_platform_key UNIQUE (workspace_id, platform)`
  - ✅ Upsert logic documented (updates existing account, does not create multiple)
  - ⚠️ **CRITICAL:** Constraint blocks multi-account per platform (intent unknown)

- [x] **Workspace Scoping**
  - ✅ Auth context resolution documented
  - ✅ Workspace validation in OAuth flows documented
  - ✅ Workspace validation in publish endpoint documented
  - ✅ RLS policies documented
  - ✅ Cross-workspace prevention checks documented

- [x] **Publish Endpoint Wiring**
  - ✅ Route identified: `POST /api/publish/youtube`
  - ✅ Implementation reviewed: `apps/web/src/pages/api/publish/youtube.ts`
  - ✅ Call chain documented (auth → plan gate → clip lookup → account resolution → job enqueue)
  - ✅ Connected account resolution documented
  - ✅ Job creation documented
  - ✅ Response shape documented

- [x] **Status Objects**
  - ✅ Job status tracking documented (`jobs` table)
  - ✅ Clip status tracking documented (`clips.status`, `clips.external_id`)
  - ✅ Variant post tracking documented (`variant_posts` table)
  - ✅ Status update flow documented (surface → worker → DB)

- [x] **Guardrails**
  - ✅ RLS bypass scan completed (admin client usage identified)
  - ✅ OAuth callback workspace validation verified
  - ✅ Publish endpoint workspace validation verified
  - ✅ Cross-workspace prevention checks documented

- [x] **Tests (Positive + Negative)**
  - ✅ Existing tests inventoried (OAuth basic, publish basic)
  - ✅ Missing tests enumerated:
    - OAuth callback token exchange tests
    - Cross-workspace access tests
    - Disabled account tests
    - Clip status validation tests
    - E2E full flow test

### Summary

**✅ Complete Coverage:** All T1 affected areas have been identified and documented with file paths and line numbers.

**⚠️ Critical Findings:**
1. OAuth callback marked "DEV-ONLY" - needs production verification
2. Schema constraint blocks multi-account per platform - intent unknown
3. Tokens stored as plaintext despite "encrypted_ref" column names
4. No PKCE implementation in OAuth flow

**📋 Ready for Execution:** T1 Phase 1 (YouTube API client) can start immediately. T1 Phase 2 (OAuth verification) requires Person 2. T1 Phase 3 (E2E test) requires Phases 1 and 2.

---

**Report Generated:** 2025-12-16  
**Auditor:** T1 Audit System  
**Next Steps:** Share with ChatGPT thread executing Track T1
