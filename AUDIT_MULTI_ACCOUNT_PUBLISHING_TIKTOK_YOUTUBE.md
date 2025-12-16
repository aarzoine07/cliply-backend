# AUDIT: Multi-Account Publishing for TikTok and YouTube

**Date:** 2025-01-XX  
**Auditor:** Backend Inspector (Audit-Only)  
**Scope:** Multi-account connection and fan-out publishing capabilities for TikTok and YouTube

---

## Executive Verdict

### TikTok

- **(A) Multi-Account Connection:** **NOT IMPLEMENTED**
  - Database constraint `UNIQUE (workspace_id, platform)` prevents multiple TikTok accounts per workspace
  - OAuth callback uses `onConflict: "workspace_id,platform"` which updates existing account instead of creating new one
  - Upsert logic in `createOrUpdateConnectedAccount` checks by `(workspace_id, platform, external_id)` but cannot create multiple accounts due to constraint

- **(B) Fan-Out Publishing:** **PARTIAL** (Code exists but blocked by connection limitation)
  - Publish endpoint accepts `connectedAccountIds` array
  - Creates one `PUBLISH_TIKTOK` job per account in loop
  - Worker pipeline processes one account per job
  - Status tracking via `variant_posts` table with `connected_account_id`
  - **BLOCKER:** Cannot function because multiple accounts cannot exist

### YouTube

- **(A) Multi-Account Connection:** **NOT IMPLEMENTED**
  - Same database constraint `UNIQUE (workspace_id, platform)` prevents multiple YouTube accounts per workspace
  - OAuth callback uses `onConflict: "workspace_id,platform"` which updates existing account
  - Same upsert limitation as TikTok

- **(B) Fan-Out Publishing:** **PARTIAL** (Code exists but blocked by connection limitation)
  - Publish endpoint accepts `connectedAccountIds` array
  - Creates one `PUBLISH_YOUTUBE` job per account in loop
  - Worker pipeline processes one account per job
  - Status tracking via `variant_posts` table with `connected_account_id`
  - **BLOCKER:** Cannot function because multiple accounts cannot exist

---

## Definition of Done (DoD)

### Multi-Account Connection

- [x] Account connection storage model supports multiple accounts per workspace/provider
  - **STATUS:** ❌ **FAILED** - Database constraint prevents this
- [x] Listing/selection of connected accounts
  - **STATUS:** ✅ **IMPLEMENTED** - `listConnectedAccounts` function exists
- [x] Token refresh strategy
  - **STATUS:** ✅ **IMPLEMENTED** - Refresh jobs exist for TikTok (`refreshTikTokTokensJob`), YouTube uses `getFreshYouTubeAccessToken`
- [x] Workspace isolation / RLS compatibility
  - **STATUS:** ✅ **IMPLEMENTED** - RLS policies exist, workspace_id foreign key with CASCADE
- [x] Observability (logs/audit events) for connect
  - **STATUS:** ✅ **IMPLEMENTED** - Audit events logged to `events_audit` table

### Multi-Account Publishing (Fan-Out)

- [x] Publish pipeline can target a specific connected account
  - **STATUS:** ✅ **IMPLEMENTED** - Job payloads include `connectedAccountId`
- [x] Fan-out: publish same clip to N accounts (loop / batch / job fan-out)
  - **STATUS:** ✅ **IMPLEMENTED** - Both endpoints create one job per account in loop
- [x] Status tracking per destination (post record per account)
  - **STATUS:** ✅ **IMPLEMENTED** - `variant_posts` table tracks per `(clip_id, connected_account_id, platform)`
- [x] Error handling + retries + DLQ behavior
  - **STATUS:** ✅ **IMPLEMENTED** - Jobs table has `attempts`, `max_attempts`, `status`, `error` fields
- [x] Workspace isolation / RLS compatibility
  - **STATUS:** ✅ **IMPLEMENTED** - Jobs have `workspace_id` foreign key, RLS policies exist
- [x] Observability (logs/audit events) for publish
  - **STATUS:** ✅ **IMPLEMENTED** - Comprehensive logging in worker pipelines

### End-to-End Flow

- [x] Long video input → ingest/store
  - **STATUS:** ✅ **IMPLEMENTED** - `YOUTUBE_DOWNLOAD` job type exists
- [x] Clip generation jobs
  - **STATUS:** ✅ **IMPLEMENTED** - `TRANSCRIBE`, `HIGHLIGHT_DETECT`, `CLIP_RENDER` job types
- [x] Artifacts → publish selection
  - **STATUS:** ✅ **IMPLEMENTED** - Clips table has `status`, `storage_path` fields
- [x] Publish jobs → provider upload
  - **STATUS:** ✅ **IMPLEMENTED** - `PUBLISH_TIKTOK`, `PUBLISH_YOUTUBE` job types with worker handlers
- [x] Post status tracking
  - **STATUS:** ✅ **IMPLEMENTED** - `variant_posts` table tracks `platform_post_id`, `status`, `posted_at`

---

## Repository Evidence Index

### 1. Database Schema - Connected Accounts

**File:** `supabase/migrations/20251123015000_connected_accounts_base.sql`

**Why it matters:** Defines the base schema for `connected_accounts` table including the critical uniqueness constraint that prevents multi-account support.

**Excerpt:**
```sql
-- Base unique constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connected_accounts_provider_external_id_key'
  ) THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_provider_external_id_key
      UNIQUE (provider, external_id);
  END IF;
END$$;

DO $$
BEGIN
  -- Guard on any existing relation (index or constraint) with this name
  IF to_regclass('public.connected_accounts_workspace_platform_key') IS NULL THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_workspace_platform_key
      UNIQUE (workspace_id, platform);
  END IF;
END$$;
```

**File:** `supabase/migrations/20251020043717_remote_schema.sql` (lines 286-299)

**Why it matters:** Shows the table structure with OAuth token fields.

**Excerpt:**
```sql
create table "public"."connected_accounts" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "workspace_id" uuid not null,
    "provider" text not null,
    "external_id" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone,
    "platform" text not null,
    "access_token_encrypted_ref" text,
    "refresh_token_encrypted_ref" text,
    "scopes" text[]
);
```

### 2. TikTok OAuth Connection Flow

**File:** `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts` (lines 168-191)

**Why it matters:** Shows TikTok OAuth callback that stores connected account using `onConflict: "workspace_id,platform"`, which prevents multiple accounts.

**Excerpt:**
```typescript
const { error: dbError } = await supabase.from("connected_accounts").upsert(
  {
    user_id,
    workspace_id,
    platform: "tiktok",
    provider: "tiktok",
    external_id: externalId,
    access_token_encrypted_ref: encryptSecret(tokenData.access_token, {
      purpose: "tiktok_token",
    }),
    refresh_token_encrypted_ref: tokenData.refresh_token
      ? encryptSecret(tokenData.refresh_token, {
          purpose: "tiktok_token",
        })
      : null,
    expires_at: expiresAt,
    scopes: tokenData.scope
      ? tokenData.scope.split(",")
      : ["user.info.basic", "video.upload"],
    status: "active",
    updated_at: new Date().toISOString(),
  },
  { onConflict: "workspace_id,platform" },
);
```

**File:** `apps/web/src/app/api/auth/tiktok/connect/route.ts`

**Why it matters:** Shows TikTok OAuth initiation endpoint that encodes workspace_id and user_id in state.

**Excerpt:**
```typescript
const statePayload = {
  workspace_id: workspaceId,
  user_id: userId,
  code_verifier: codeVerifier,
};
```

### 3. YouTube OAuth Connection Flow

**File:** `apps/web/src/app/api/auth/youtube/callback/route.ts` (lines 212-237)

**Why it matters:** Shows YouTube OAuth callback that also uses `onConflict: "workspace_id,platform"`, preventing multiple accounts.

**Excerpt:**
```typescript
const { error: dbError } = await supabase
  .from("connected_accounts")
  .upsert(
    {
      user_id,
      workspace_id,
      platform: "youtube",
      provider: "google",
      external_id: channelInfo.channelId,
      access_token_encrypted_ref: encryptSecret(
        tokenData.accessToken,
        { purpose: "youtube_token" },
      ),
      refresh_token_encrypted_ref: encryptSecret(
        tokenData.refreshToken,
        { purpose: "youtube_token" },
      ),
      expires_at: tokenData.expiresAt,
      scopes: tokenData.scope
        ? tokenData.scope.split(" ")
        : [],
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,platform" },
  );
```

**File:** `apps/web/src/lib/accounts/youtubeOauthService.ts` (lines 30-73)

**Why it matters:** Shows YouTube OAuth service that calls `createOrUpdateConnectedAccount` which uses upsert logic.

**Excerpt:**
```typescript
export async function completeYouTubeOAuthFlow(params: {
  workspaceId: string;
  userId: string;
  code: string;
  redirectUri: string;
  state?: string;
}, ctx: { supabase: SupabaseClient }): Promise<{ accountId: string; channelInfo: YouTubeChannelInfo }> {
  // Exchange code for tokens
  const tokenData = await exchangeYouTubeCodeForTokens({
    code: params.code,
    redirectUri: params.redirectUri,
  });

  // Fetch channel info
  const channelInfo = await fetchYouTubeChannelForToken(tokenData.accessToken);

  // Upsert connected account
  const account = await connectedAccountsService.createOrUpdateConnectedAccount(
    {
      workspaceId: params.workspaceId,
      userId: params.userId,
      platform: "youtube",
      provider: "google",
      external_id: channelInfo.channelId,
      display_name: channelInfo.channelTitle,
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
      expires_at: tokenData.expiresAt,
    },
    ctx,
  );
```

### 4. Connected Accounts Service - Upsert Logic

**File:** `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 64-175)

**Why it matters:** Shows the upsert logic that checks by `(workspace_id, platform, external_id)` but cannot create multiple accounts due to database constraint.

**Excerpt:**
```typescript
export async function createOrUpdateConnectedAccount(
  params: {
    workspaceId: string;
    userId: string;
  } & CreateConnectedAccountInput,
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto> {
  // Extract only the fields that belong to the schema
  const { workspaceId, userId, ...inputData } = params;
  const parsed = CreateConnectedAccountInputSchema.parse(inputData);

  // Check for existing account by (workspace_id, platform, external_id)
  const { data: existing, error: lookupError } = await ctx.supabase
    .from("connected_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("platform", parsed.platform)
    .eq("external_id", parsed.external_id)
    .maybeSingle();
```

**File:** `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 233-325)

**Why it matters:** Shows `getConnectedAccountsForPublish` function that validates and returns multiple accounts for publishing (if they existed).

**Excerpt:**
```typescript
export async function getConnectedAccountsForPublish(
  params: {
    workspaceId: string;
    platform: ConnectedAccountPlatform;
    connectedAccountIds?: string[];
  },
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto[]> {
  // Map platform to provider (for now, they're the same)
  const provider = params.platform;

  if (params.connectedAccountIds && params.connectedAccountIds.length > 0) {
    // Validate specific accounts
    const { data: accounts, error } = await ctx.supabase
      .from("connected_accounts")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("platform", params.platform)
      .in("id", params.connectedAccountIds)
      .eq("status", "active");
```

### 5. TikTok Publishing - Fan-Out Implementation

**File:** `apps/web/src/pages/api/publish/tiktok.ts` (lines 166-326)

**Why it matters:** Shows TikTok publish endpoint that accepts `connectedAccountIds` array and creates one job per account.

**Excerpt:**
```typescript
// Resolve connected accounts for publishing (multi-account)
let resolvedAccountIds: string[] = [];
try {
  // Determine which accounts to use
  const requestedAccountIds =
    parsed.data.connectedAccountIds ||
    (parsed.data.connectedAccountId
      ? [parsed.data.connectedAccountId]
      : []);

  const accounts =
    await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId,
        platform: 'tiktok',
        connectedAccountIds:
          requestedAccountIds.length > 0
            ? requestedAccountIds
            : undefined,
      },
      { supabase: admin },
    );
  resolvedAccountIds = accounts.map((a) => a.id);
```

**Excerpt (job creation loop):**
```typescript
// Create one job per account (multi-account publishing loop)
const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_TIKTOK' as const,
  status: 'queued' as const,
  payload: {
    clipId: parsed.data.clipId,
    connectedAccountId,
    caption: parsed.data.caption,
    privacyLevel:
      parsed.data.privacyLevel || 'PUBLIC_TO_EVERYONE',
    experimentId: parsed.data.experimentId ?? null,
    variantId: parsed.data.variantId ?? null,
  },
}));

const jobInserts = await admin
  .from('jobs')
  .insert(jobPayloads)
  .select();
```

### 6. YouTube Publishing - Fan-Out Implementation

**File:** `apps/web/src/pages/api/publish/youtube.ts` (lines 164-355)

**Why it matters:** Shows YouTube publish endpoint that accepts `connectedAccountIds` array and creates one job per account.

**Excerpt:**
```typescript
// Resolve connected accounts for publishing (multi-account support)
let resolvedAccountIds: string[] = [];
try {
  const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
    {
      workspaceId,
      platform: 'youtube',
      connectedAccountIds: parsed.data.connectedAccountIds,
    },
    { supabase: admin },
  );
  resolvedAccountIds = accounts.map((a) => a.id);
```

**Excerpt (job creation loop):**
```typescript
// Create one job per account (multi-account publishing loop)
const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_YOUTUBE' as const,
  status: 'queued' as const,
  payload: {
    clipId: parsed.data.clipId,
    connectedAccountId,
    visibility: parsed.data.visibility,
    title: parsed.data.titleOverride ?? null,
    description: parsed.data.descriptionOverride ?? null,
    tags: undefined, // Not in current input schema, but available in job schema
    experimentId: parsed.data.experimentId ?? null,
    variantId: parsed.data.variantId ?? null,
  },
}));

const jobInserts = await admin.from('jobs').insert(jobPayloads).select();
```

### 7. Job Schemas - Connected Account ID

**File:** `packages/shared/src/schemas/jobs.ts` (lines 39-63)

**Why it matters:** Shows job payload schemas that include `connectedAccountId` field for both TikTok and YouTube.

**Excerpt:**
```typescript
export const PUBLISH_YOUTUBE = z
  .object({
    clipId: z.string().uuid(),
    connectedAccountId: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    visibility: z.enum(["public", "unlisted", "private"]).optional(),
    // Optional viral experiment fields
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
  })
  .strict();

export const PUBLISH_TIKTOK = z
  .object({
    clipId: z.string().uuid(),
    connectedAccountId: z.string().uuid(),
    caption: z.string().optional(),
    privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIEND", "SELF_ONLY"]).optional(),
    // Optional viral experiment fields (for future use)
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
  })
  .strict();
```

### 8. Worker Pipelines - Per-Account Processing

**File:** `apps/worker/src/pipelines/publish-tiktok.ts` (lines 34-446)

**Why it matters:** Shows TikTok worker pipeline that processes one account per job, fetches connected account, and tracks status per account.

**Excerpt:**
```typescript
export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  const payload = PUBLISH_TIKTOK.parse(job.payload);
  
  // Fetch connected account
  const account = await fetchConnectedAccount(ctx, payload.connectedAccountId, workspaceId);
  if (!account) {
    throw new Error(`TikTok connected account not found: ${payload.connectedAccountId}`);
  }
```

**Excerpt (status tracking):**
```typescript
// Update variant_posts after successful publish
try {
  await variantPostsService.updateVariantPostAfterPublish(
    {
      clipId: payload.clipId,
      workspaceId,
      platformPostId: response.videoId,
      platform: "tiktok",
      connectedAccountId: payload.connectedAccountId,
    },
    { supabase: ctx.supabase },
  );
```

**File:** `apps/worker/src/pipelines/publish-youtube.ts` (lines 40-337)

**Why it matters:** Shows YouTube worker pipeline with similar per-account processing.

**Excerpt:**
```typescript
export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  const payload = PUBLISH_YOUTUBE.parse(job.payload);
  const workspaceId = job.workspaceId;
  
  // ... clip validation ...
  
  // Check if already published for this specific account (idempotency per account)
  if (payload.experimentId && payload.variantId) {
    const { data: existingPost } = await ctx.supabase
      .from("variant_posts")
      .select("id, status, platform_post_id")
      .eq("clip_id", payload.clipId)
      .eq("connected_account_id", payload.connectedAccountId)
      .eq("variant_id", payload.variantId)
      .eq("platform", "youtube_shorts")
      .maybeSingle();
```

### 9. Variant Posts - Status Tracking Per Account

**File:** `supabase/migrations/20251123021611_viral_experiments.sql` (lines 33-45)

**Why it matters:** Shows `variant_posts` table schema that tracks posts per `(clip_id, connected_account_id, platform)`.

**Excerpt:**
```sql
-- Variant posts: represents one posting of a variant to a connected account
CREATE TABLE IF NOT EXISTS variant_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id          uuid NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  clip_id             uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('tiktok', 'youtube_shorts', 'instagram_reels')),
  platform_post_id    text NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'deleted', 'failed')),
  posted_at           timestamptz NULL,
  deleted_at          timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

**File:** `apps/worker/src/services/viral/variantPosts.ts` (lines 9-65)

**Why it matters:** Shows service that updates `variant_posts` after successful publish, filtering by `connected_account_id`.

**Excerpt:**
```typescript
export async function updateVariantPostAfterPublish(
  params: {
    clipId: string;
    workspaceId: string;
    platformPostId: string;
    platform: "tiktok" | "youtube_shorts" | "instagram_reels";
    connectedAccountId?: string; // Optional: if provided, only update posts for this account
  },
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Build update query
  let query = ctx.supabase
    .from("variant_posts")
    .update({
      status: "posted",
      platform_post_id: params.platformPostId,
      posted_at: new Date().toISOString(),
    })
    .eq("clip_id", params.clipId)
    .eq("platform", params.platform)
    .in("status", ["pending"]); // Only update pending posts

  // If connectedAccountId is provided, filter by it
  if (params.connectedAccountId) {
    query = query.eq("connected_account_id", params.connectedAccountId);
  }
```

### 10. Orchestration Service - Multi-Account Fan-Out

**File:** `apps/web/src/lib/viral/orchestrationService.ts` (lines 10-149)

**Why it matters:** Shows orchestration service that creates `variant_posts` for multiple connected accounts.

**Excerpt:**
```typescript
export async function createVariantPostsForClip(
  params: {
    workspaceId: string;
    clipId: string;
    experimentId: string;
    variantId: string;
    platform: "tiktok" | "youtube_shorts" | "instagram_reels";
    connectedAccountIds?: string[];
  },
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // ... validation ...
  
  // Determine which connected accounts to use via service layer
  let accounts;
  try {
    accounts = await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId: params.workspaceId,
        platform: provider,
        connectedAccountIds: params.connectedAccountIds,
      },
      ctx,
    );
  } catch (error) {
    // ... error handling ...
  }
  
  // Accounts are already validated by getConnectedAccountsForPublish
  const accountIds = accounts.map((a) => a.id);
  
  // Check for existing variant_posts to avoid duplicates (idempotency)
  const { data: existing, error: existingError } = await ctx.supabase
    .from("variant_posts")
    .select("connected_account_id")
    .eq("variant_id", params.variantId)
    .eq("clip_id", params.clipId)
    .in("connected_account_id", accountIds);
```

### 11. Publish Input Schemas - Multi-Account Support

**File:** `packages/shared/src/schemas.ts` (lines 122-156)

**Why it matters:** Shows input schemas that accept `connectedAccountIds` array for both platforms.

**Excerpt:**
```typescript
export const PublishYouTubeInput = z
  .object({
    clipId: z.string().uuid(),
    visibility: z.enum(['public', 'unlisted', 'private']),
    scheduleAt: z.string().datetime({ offset: true }).optional(),
    accountId: z.string().min(1).optional(),
    titleOverride: z.string().max(120).optional(),
    descriptionOverride: z.string().max(5000).optional(),
    // Viral experiment fields (optional for V1)
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    connectedAccountIds: z.array(z.string().uuid()).optional(), // For multi-account posting
  })
  .strict();

export const PublishTikTokInput = z
  .object({
    clipId: z.string().uuid(),
    caption: z.string().max(2200).optional(),
    privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIEND', 'SELF_ONLY']).optional(),
    connectedAccountId: z.string().uuid().optional(),
    connectedAccountIds: z.array(z.string().uuid()).optional(), // For multi-account posting
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
  })
  .strict();
```

---

## Data Model & Storage Audit

### Connected Accounts Table

**Location:** `supabase/migrations/20251123015000_connected_accounts_base.sql`

**Schema:**
- Primary key: `id` (uuid)
- Foreign keys: `workspace_id` → `workspaces(id) ON DELETE CASCADE`, `user_id` → `auth.users(id) ON DELETE CASCADE`
- Unique constraints:
  1. `UNIQUE (provider, external_id)` - Prevents duplicate external accounts across all workspaces
  2. **`UNIQUE (workspace_id, platform)`** - **CRITICAL BLOCKER:** Prevents multiple accounts per platform per workspace

**Fields:**
- `platform`: text (CHECK: 'tiktok' | 'youtube')
- `provider`: text (e.g., 'tiktok', 'google')
- `external_id`: text (TikTok open_id, YouTube channel_id)
- `display_name`: text nullable
- `handle`: text nullable
- `status`: text (CHECK: 'active' | 'revoked' | 'error')
- `access_token_encrypted_ref`: text nullable
- `refresh_token_encrypted_ref`: text nullable
- `expires_at`: timestamptz nullable
- `scopes`: text[] nullable

**Multi-Account Support:** ❌ **NO** - The `UNIQUE (workspace_id, platform)` constraint prevents multiple accounts per platform per workspace.

**Evidence:**
```sql
-- From supabase/migrations/20251123015000_connected_accounts_base.sql
IF to_regclass('public.connected_accounts_workspace_platform_key') IS NULL THEN
  ALTER TABLE public.connected_accounts
    ADD CONSTRAINT connected_accounts_workspace_platform_key
    UNIQUE (workspace_id, platform);
END IF;
```

### Variant Posts Table (Status Tracking)

**Location:** `supabase/migrations/20251123021611_viral_experiments.sql`

**Schema:**
- Primary key: `id` (uuid)
- Foreign keys: `variant_id` → `experiment_variants(id)`, `clip_id` → `clips(id)`, `connected_account_id` → `connected_accounts(id)`
- **No unique constraint on `(clip_id, connected_account_id, platform)`** - Allows multiple posts per clip per account (for experiments)

**Fields:**
- `connected_account_id`: uuid (references connected_accounts)
- `platform`: text (CHECK: 'tiktok' | 'youtube_shorts' | 'instagram_reels')
- `platform_post_id`: text nullable (external platform post ID)
- `status`: text (CHECK: 'pending' | 'posted' | 'deleted' | 'failed')
- `posted_at`: timestamptz nullable

**Multi-Account Support:** ✅ **YES** - Table structure supports tracking posts per account, but requires multiple accounts to exist (which they cannot due to constraint above).

---

## OAuth Connect Flows Audit

### TikTok OAuth Flow

**Start Endpoint:** `apps/web/src/app/api/auth/tiktok/connect/route.ts`

**State Contents:**
- Encodes `{ workspace_id, user_id, code_verifier }` in base64url
- Validates `workspace_id` from query parameter

**Callback Endpoint:** `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts`

**Token Exchange:**
- Exchanges authorization code for access/refresh tokens via TikTok OAuth2 API
- Fetches user info to get `open_id` (external_id)

**Storage:**
- Uses `supabase.from("connected_accounts").upsert(..., { onConflict: "workspace_id,platform" })`
- **CRITICAL:** `onConflict: "workspace_id,platform"` means if an account already exists for this workspace+platform, it **UPDATES** the existing row instead of creating a new one
- Stores encrypted tokens, expires_at, scopes

**Account/Channel Fetch:**
- Fetches user info from `https://open.tiktokapis.com/v2/user/info/`
- Uses `open_id` as `external_id`

**Upsert Behavior:**
- **BLOCKER:** Cannot create multiple accounts because:
  1. Database constraint `UNIQUE (workspace_id, platform)` prevents insertion
  2. Upsert uses `onConflict: "workspace_id,platform"` which updates existing row

**Evidence:**
```typescript
// From apps/web/src/app/api/auth/tiktok/connect/callback/route.ts:168-191
const { error: dbError } = await supabase.from("connected_accounts").upsert(
  {
    // ... account data ...
  },
  { onConflict: "workspace_id,platform" },
);
```

### YouTube OAuth Flow

**Start Endpoint:** `apps/web/src/pages/api/oauth/google/start.ts` (legacy) or via `youtubeOauthService.buildYouTubeAuthUrl`

**State Contents:**
- Encodes `{ workspaceId, userId }` in base64url

**Callback Endpoint:** `apps/web/src/app/api/auth/youtube/callback/route.ts`

**Token Exchange:**
- Exchanges authorization code for access/refresh tokens via Google OAuth2 API
- Fetches channel info to get `channel_id` (external_id)

**Storage:**
- Uses `supabase.from("connected_accounts").upsert(..., { onConflict: "workspace_id,platform" })`
- **CRITICAL:** Same limitation as TikTok - updates existing account instead of creating new one

**Account/Channel Fetch:**
- Fetches channel from `https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`
- Uses `channel_id` as `external_id`

**Upsert Behavior:**
- **BLOCKER:** Same as TikTok - cannot create multiple accounts due to constraint and upsert conflict resolution

**Evidence:**
```typescript
// From apps/web/src/app/api/auth/youtube/callback/route.ts:212-237
const { error: dbError } = await supabase
  .from("connected_accounts")
  .upsert(
    {
      // ... account data ...
    },
    { onConflict: "workspace_id,platform" },
  );
```

---

## Publishing Pipeline Audit (Core)

### TikTok Publishing

**Trigger:** `POST /api/publish/tiktok` (`apps/web/src/pages/api/publish/tiktok.ts`)

**Destination Account Selection:**
- Accepts `connectedAccountIds` array in request body
- Calls `connectedAccountsService.getConnectedAccountsForPublish()` to validate accounts
- If `connectedAccountIds` not provided, returns all active accounts for platform

**Clip → Connected Account Mapping:**
- Creates one `PUBLISH_TIKTOK` job per account in `resolvedAccountIds` array
- Each job payload includes `connectedAccountId`

**Post Storage/Tracking:**
- Worker pipeline updates `variant_posts` table after successful publish
- Tracks `platform_post_id`, `status`, `posted_at` per `(clip_id, connected_account_id, platform)`
- Also updates `clips.external_id` (legacy, only for first account)

**Upload Client:**
- `TikTokClient` class in `apps/worker/src/services/tiktok/client.ts`
- Implements `uploadVideo()` method

**Provider API Client:**
- ✅ **IMPLEMENTED** - Full TikTok API client with error handling, retries

**Evidence:**
```typescript
// From apps/web/src/pages/api/publish/tiktok.ts:288-302
const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_TIKTOK' as const,
  status: 'queued' as const,
  payload: {
    clipId: parsed.data.clipId,
    connectedAccountId,
    // ... other fields ...
  },
}));
```

### YouTube Publishing

**Trigger:** `POST /api/publish/youtube` (`apps/web/src/pages/api/publish/youtube.ts`)

**Destination Account Selection:**
- Accepts `connectedAccountIds` array in request body
- Calls `connectedAccountsService.getConnectedAccountsForPublish()` to validate accounts
- If `connectedAccountIds` not provided, returns all active accounts for platform

**Clip → Connected Account Mapping:**
- Creates one `PUBLISH_YOUTUBE` job per account in `resolvedAccountIds` array
- Each job payload includes `connectedAccountId`

**Post Storage/Tracking:**
- Worker pipeline updates `variant_posts` table after successful publish
- Tracks `platform_post_id`, `status`, `posted_at` per `(clip_id, connected_account_id, platform)`
- Also updates `clips.external_id` (legacy, only for first account)

**Upload Client:**
- `YouTubeClient` class in `apps/worker/src/services/youtube/client.ts`
- Implements `uploadShort()` method

**Provider API Client:**
- ✅ **IMPLEMENTED** - Full YouTube API client with error handling

**Evidence:**
```typescript
// From apps/web/src/pages/api/publish/youtube.ts:323-338
const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_YOUTUBE' as const,
  status: 'queued' as const,
  payload: {
    clipId: parsed.data.clipId,
    connectedAccountId,
    // ... other fields ...
  },
}));
```

---

## Fan-Out Capability Audit

### Can One Clip Be Published to Multiple Connected Accounts?

**Answer:** ✅ **YES** (Code exists) but ❌ **NO** (Cannot function due to connection limitation)

### Implementation Details

**TikTok:**
- Publish endpoint accepts `connectedAccountIds: string[]` array
- Creates one `PUBLISH_TIKTOK` job per account in loop:
  ```typescript
  const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
    // ... job payload with connectedAccountId ...
  }));
  ```
- Each job is processed independently by worker
- Status tracked per account via `variant_posts` table

**YouTube:**
- Publish endpoint accepts `connectedAccountIds: string[]` array
- Creates one `PUBLISH_YOUTUBE` job per account in loop:
  ```typescript
  const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
    // ... job payload with connectedAccountId ...
  }));
  ```
- Each job is processed independently by worker
- Status tracked per account via `variant_posts` table

### What Exists (Single-Target Only)

**Current Behavior:**
- If user connects a second TikTok/YouTube account, OAuth callback **UPDATES** the existing account row
- `getConnectedAccountsForPublish()` can only return 0 or 1 account per platform per workspace
- Fan-out loop creates 0 or 1 job (never multiple)

**Evidence:**
```typescript
// From apps/web/src/lib/accounts/connectedAccountsService.ts:292-299
// Return all active accounts for platform
const { data: accounts, error } = await ctx.supabase
  .from("connected_accounts")
  .select("*")
  .eq("workspace_id", params.workspaceId)
  .eq("platform", params.platform)
  .eq("status", "active")
  .order("created_at", { ascending: true });
```

### What's Missing

1. **Database Schema Change:**
   - Remove `UNIQUE (workspace_id, platform)` constraint
   - Add `UNIQUE (workspace_id, platform, external_id)` to prevent duplicate external accounts per workspace
   - Or use `UNIQUE (workspace_id, external_id)` if external_id is globally unique

2. **OAuth Callback Changes:**
   - Change `onConflict` from `"workspace_id,platform"` to `"workspace_id,platform,external_id"` or `"external_id"`
   - Allow creation of new account row when `external_id` differs

3. **Upsert Logic Changes:**
   - `createOrUpdateConnectedAccount` already checks by `(workspace_id, platform, external_id)` which is correct
   - But database constraint prevents insertion of second account with different `external_id`

---

## End-to-End Flow Readiness

### Flow Mapping

**1. Input Long Video → Ingest/Store**
- ✅ **IMPLEMENTED**
- Job type: `YOUTUBE_DOWNLOAD`
- Stores video in storage, creates project

**2. Clip Generation Jobs**
- ✅ **IMPLEMENTED**
- Job types: `TRANSCRIBE`, `HIGHLIGHT_DETECT`, `CLIP_RENDER`, `THUMBNAIL_GEN`
- Creates clips in `clips` table with `status: 'ready'`

**3. Artifacts → Publish Selection**
- ✅ **IMPLEMENTED**
- Clips have `status`, `storage_path` fields
- Publish endpoints validate clip is `ready` and has `storage_path`

**4. Publish Jobs → Provider Upload**
- ✅ **IMPLEMENTED**
- Job types: `PUBLISH_TIKTOK`, `PUBLISH_YOUTUBE`
- Worker pipelines download clip, upload to provider API
- Update `variant_posts` with `platform_post_id`

**5. Post Status Tracking**
- ✅ **IMPLEMENTED**
- `variant_posts` table tracks `status`, `platform_post_id`, `posted_at` per account
- Jobs table tracks job `status`, `attempts`, `error`

### Missing Links

1. **Multi-Account Connection:** ❌ **BLOCKED** - Database constraint prevents multiple accounts
2. **Multi-Account Publishing:** ⚠️ **PARTIAL** - Code exists but cannot function without multiple accounts
3. **Per-Account External ID Tracking:** ⚠️ **PARTIAL** - `variant_posts.platform_post_id` tracks per account, but `clips.external_id` only stores first account's post ID

---

## Gaps & Next Steps (No Code)

### Critical Blockers

1. **Database Constraint Removal**
   - **Finding:** `UNIQUE (workspace_id, platform)` constraint in `connected_accounts` table prevents multiple accounts per platform per workspace
   - **Impact:** Users cannot connect multiple TikTok or YouTube accounts to the same workspace
   - **Evidence:** `supabase/migrations/20251123015000_connected_accounts_base.sql:45-49`

2. **OAuth Upsert Conflict Resolution**
   - **Finding:** Both TikTok and YouTube OAuth callbacks use `onConflict: "workspace_id,platform"` which updates existing account instead of creating new one
   - **Impact:** Even if constraint were removed, OAuth flow would still overwrite existing account
   - **Evidence:** 
     - `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts:190`
     - `apps/web/src/app/api/auth/youtube/callback/route.ts:236`

### Missing Components

3. **Unique Constraint Redesign**
   - **Finding:** Need to replace `UNIQUE (workspace_id, platform)` with constraint that allows multiple accounts per platform
   - **Recommendation:** Use `UNIQUE (workspace_id, external_id)` if external_id is globally unique, or `UNIQUE (workspace_id, platform, external_id)` if external_id can repeat across platforms
   - **Impact:** Enables multiple accounts per platform per workspace

4. **OAuth Callback Conflict Resolution Update**
   - **Finding:** OAuth callbacks need to change `onConflict` to match new unique constraint
   - **Recommendation:** Change to `onConflict: "workspace_id,external_id"` or `onConflict: "external_id"` depending on external_id uniqueness
   - **Impact:** Allows creation of new account when external_id differs

5. **Account Listing UI/API Enhancement**
   - **Finding:** `listConnectedAccounts` function exists and works, but UI may need updates to show multiple accounts
   - **Impact:** Users need to see and select from multiple connected accounts
   - **Status:** ✅ Service layer ready, UI changes may be needed

6. **Per-Account External ID in Clips Table**
   - **Finding:** `clips.external_id` only stores one post ID (first account's)
   - **Recommendation:** Consider removing `clips.external_id` or making it nullable, rely on `variant_posts.platform_post_id` for per-account tracking
   - **Impact:** Better tracking of which account posted which clip

### Non-Blocking Enhancements

7. **Account Display Name/Handle Consistency**
   - **Finding:** `connected_accounts` has `display_name` and `handle` fields, but OAuth callbacks may not always populate them
   - **Impact:** UI may show incomplete account information

8. **Token Refresh Job for Multiple Accounts**
   - **Finding:** `refreshTikTokTokensJob` exists but may need to handle multiple accounts per workspace
   - **Impact:** Token refresh may not work correctly for all accounts if multiple exist

9. **Error Handling for Partial Fan-Out Failures**
   - **Finding:** If one account fails to publish, other accounts may still succeed, but error reporting may not be granular
   - **Impact:** Users may not know which accounts succeeded/failed

10. **Idempotency Key Per Account**
   - **Finding:** Current idempotency uses request body hash, which may not distinguish between different account selections
   - **Impact:** Retrying with different accounts may be treated as duplicate request

---

## Summary

### Current State

- **Multi-Account Connection:** ❌ **NOT IMPLEMENTED** - Database constraint blocks multiple accounts
- **Fan-Out Publishing Code:** ✅ **IMPLEMENTED** - Code exists and would work if multiple accounts existed
- **End-to-End Flow:** ⚠️ **PARTIAL** - Pipeline works for single account, blocked for multi-account

### Verdict

**TikTok:**
- Connect: **NOT IMPLEMENTED** (blocked by constraint)
- Publish Fan-Out: **PARTIAL** (code exists, cannot function)

**YouTube:**
- Connect: **NOT IMPLEMENTED** (blocked by constraint)
- Publish Fan-Out: **PARTIAL** (code exists, cannot function)

### Primary Blocker

The `UNIQUE (workspace_id, platform)` constraint in the `connected_accounts` table prevents the system from storing multiple accounts per platform per workspace. This constraint must be removed and replaced with a constraint that allows multiple accounts while preventing duplicates.

