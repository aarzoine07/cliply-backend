# AUDIT_MULTI_ACCOUNT_MULTI_PLATFORM_PER_WORKSPACE.md

**Date:** 2025-01-XX  
**Scope:** Cliply Backend Multi-Account / Multi-Platform Publishing per Workspace  
**Method:** Repository Evidence-Based Audit (Read-Only)

---

## A) Executive Verdict (One Screen Max)

### TikTok

**(A) Connect: PARTIAL**  
OAuth flow implemented with connect/callback endpoints, token storage, and refresh. **CRITICAL BLOCKER:** Database UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)` prevents multiple TikTok accounts per workspace. See [Evidence E.1](#e-data-model--storage-audit-critical).

**Citations:** [E.1](#e-data-model--storage-audit-critical), [F.1](#f-oauth-connect-flows-audit-tiktok-and-youtube-separately)

**(B) Publish Fan-Out: IMPLEMENTED**  
Publish endpoint accepts `connectedAccountIds[]` array, resolves accounts via `connectedAccountsService.getConnectedAccountsForPublish()`, and creates one `PUBLISH_TIKTOK` job per account. Cron `scanSchedules` supports multi-account via `publish_config.default_connected_account_ids`. Worker pipeline handles single account per job.

**Citations:** [G.1](#g-publish--job-pipeline-audit-tiktok-and-youtube-separately), [H.1](#h-fan-out-capability-audit-answer-explicitly)

### YouTube

**(A) Connect: PARTIAL**  
OAuth flow implemented with connect/callback endpoints, token storage, and refresh. **CRITICAL BLOCKER:** Same UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)` prevents multiple YouTube accounts per workspace.

**Citations:** [E.1](#e-data-model--storage-audit-critical), [F.2](#f-oauth-connect-flows-audit-tiktok-and-youtube-separately)

**(B) Publish Fan-Out: IMPLEMENTED**  
Publish endpoint accepts `connectedAccountIds[]` array, resolves accounts, and creates one `PUBLISH_YOUTUBE` job per account. Cron supports multi-account via `publish_config`. Worker pipeline handles single account per job.

**Citations:** [G.2](#g-publish--job-pipeline-audit-tiktok-and-youtube-separately), [H.2](#h-fan-out-capability-audit-answer-explicitly)

---

## B) Scope Definition (What "Multi-Account / Multi-Platform per Workspace" Means Here)

**Definition of "Done":**

1. **Multiple Connected Accounts per Provider:** A workspace can connect N TikTok accounts and M YouTube accounts, all stored and retrievable.
2. **Account Listing & Selection:** API endpoints can list all connected accounts for a workspace/platform, and UI/API can select specific accounts for publishing.
3. **Publishing Targets:**
   - Single account: Publish to one specific connected account
   - Fan-out: Publish the same clip to multiple connected accounts in one request
4. **Status Tracking:** Per-destination tracking (per clip + per account) via `variant_posts` table or equivalent.
5. **Scheduling:** Cron `scanSchedules` can publish to multiple accounts per schedule via `publish_config.default_connected_account_ids`.

---

## C) Definition of Done Checklist

| Item | Status | Evidence |
|------|--------|----------|
| **Data Model** |
| Data model supports multiple accounts per workspace/provider | ❌ **BLOCKED** | [E.1](#e-data-model--storage-audit-critical) - UNIQUE constraint `(workspace_id, platform)` |
| Uniqueness constraints match multi-account intent | ❌ **BLOCKED** | [E.1](#e-data-model--storage-audit-critical) - Constraint prevents multiple accounts |
| External provider accounts cannot be connected to more than one workspace (global uniqueness) | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - UNIQUE constraint on `(provider, external_id)` enforces global uniqueness |
| **Account Management** |
| Account listing endpoints + filtering by workspace/platform | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - `connectedAccountsService.listConnectedAccounts()` |
| Account selection model for publish (request payload) | ✅ **IMPLEMENTED** | [G.1](#g-publish--job-pipeline-audit-tiktok-and-youtube-separately) - `connectedAccountIds[]` in schemas |
| Schedule model fields (account selection) | ✅ **IMPLEMENTED** | [E.3](#e-data-model--storage-audit-critical) - `schedules.platform`, uses `publish_config` |
| Job payload fields (account selection) | ✅ **IMPLEMENTED** | [G.1](#g-publish--job-pipeline-audit-tiktok-and-youtube-separately) - `connectedAccountId` in job payload |
| **Fan-Out Mechanics** |
| Loop/batch logic location | ✅ **IMPLEMENTED** | [H.1](#h-fan-out-capability-audit-answer-explicitly) - `resolvedAccountIds.map()` in publish endpoints |
| Job creation strategy | ✅ **IMPLEMENTED** | [H.1](#h-fan-out-capability-audit-answer-explicitly) - N jobs (one per account) |
| **Post Records** |
| Post record model (clip_id + connected_account_id + provider_post_id + status) | ✅ **IMPLEMENTED** | [E.4](#e-data-model--storage-audit-critical) - `variant_posts` table |
| **Token Refresh** |
| Refresh token persistence | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - `refresh_token_encrypted_ref` column |
| Refresh trigger point | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - `refreshTikTokTokensJob()` cron |
| Expiry handling | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - `expires_at` column, refresh logic |
| **Error Handling & Retry** |
| Job attempts/max_attempts | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - `jobs.attempts`, `jobs.max_attempts` |
| DLQ path | ⚠️ **PARTIAL** | [E.1](#e-data-model--storage-audit-critical) - Jobs table has `status='failed'`, but explicit DLQ table not found |
| Idempotency strategy | ✅ **IMPLEMENTED** | [E.5](#e-data-model--storage-audit-critical) - `idempotency_keys` table, used in `enqueueJob()` |
| **Workspace Isolation / RLS** |
| RLS policies for connected_accounts | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - Policy `ca_all` checks `user_id = auth.uid()` |
| RLS policies for publish_config | ⚠️ **NOT PROVABLE** | [E.2](#e-data-model--storage-audit-critical) - Table exists, RLS policies not found in migrations |
| RLS policies for schedules | ✅ **IMPLEMENTED** | [E.3](#e-data-model--storage-audit-critical) - Policy `sch_all` via workspace membership |
| RLS policies for posts (variant_posts) | ✅ **IMPLEMENTED** | [E.4](#e-data-model--storage-audit-critical) - Policy `variant_posts_workspace_member_access` |
| Service-role boundaries | ✅ **IMPLEMENTED** | [E.1](#e-data-model--storage-audit-critical) - Service role policies exist |
| **Observability** |
| Structured logs | ✅ **IMPLEMENTED** | [G.1](#g-publish--job-pipeline-audit-tiktok-and-youtube-separately) - Logger calls throughout |
| Audit logging for connect/publish | ✅ **IMPLEMENTED** | [F.1](#f-oauth-connect-flows-audit-tiktok-and-youtube-separately) - `events_audit` table inserts |

---

## D) Repository Evidence Index

1. **`supabase/migrations/20251020043717_remote_schema.sql`** (lines 286-299, 546-548)  
   Defines `connected_accounts` table schema with UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)`. This constraint **blocks multiple accounts per workspace per platform**.

2. **`apps/web/src/app/api/auth/tiktok/connect/callback/route.ts`** (lines 168-191)  
   TikTok OAuth callback upserts connected account using `onConflict: "workspace_id,platform"`, which enforces single account per workspace.

3. **`apps/web/src/app/api/auth/youtube/callback/route.ts`** (lines 74-84)  
   YouTube OAuth callback calls `completeYouTubeOAuthFlow()` which uses `connectedAccountsService.createOrUpdateConnectedAccount()`.

4. **`apps/web/src/lib/accounts/connectedAccountsService.ts`** (lines 64-175)  
   `createOrUpdateConnectedAccount()` checks for existing account by `(workspace_id, platform)` and updates if found, creates if not. This logic assumes single account per workspace per platform.

5. **`apps/web/src/pages/api/publish/tiktok.ts`** (lines 267-312, 479-507)  
   TikTok publish endpoint accepts `connectedAccountIds[]`, resolves accounts via `getConnectedAccountsForPublish()`, and creates one job per account in loop.

6. **`apps/web/src/pages/api/publish/youtube.ts`** (lines 278-327, 493-523)  
   YouTube publish endpoint accepts `connectedAccountIds[]`, resolves accounts, and creates one job per account in loop.

7. **`apps/web/src/lib/cron/scanSchedules.ts`** (lines 146-250)  
   Cron `scanSchedules` reads `publish_config.default_connected_account_ids` and enqueues one job per account for each schedule.

8. **`supabase/migrations/20251124000000_add_publish_config.sql`**  
   Defines `publish_config` table with `default_connected_account_ids uuid[]` array column for multi-account defaults.

9. **`supabase/migrations/20251201000000_add_platform_to_schedules.sql`**  
   Adds `platform` column to `schedules` table for multi-platform support.

10. **`supabase/migrations/20251123021611_viral_experiments.sql`** (lines 33-45)  
    Defines `variant_posts` table with `clip_id`, `connected_account_id`, `platform_post_id`, `status` for per-account post tracking.

11. **`apps/worker/src/pipelines/publish-tiktok.ts`** (lines 34-470)  
    TikTok publish pipeline handles single `connectedAccountId` per job, checks `variant_posts` for idempotency per account.

12. **`apps/worker/src/pipelines/publish-youtube.ts`** (lines 40-337)  
    YouTube publish pipeline handles single `connectedAccountId` per job, checks `variant_posts` for idempotency per account.

13. **`packages/shared/src/schemas.ts`** (lines 120-156)  
    `PublishTikTokInput` and `PublishYouTubeInput` schemas include `connectedAccountIds: z.array(z.string().uuid()).optional()`.

14. **`apps/web/src/lib/enqueueJob.ts`** (lines 140-207)  
    `enqueueJob()` uses `idempotency_keys` table for deduplication via `key_hash`.

15. **`supabase/migrations/20251020043717_remote_schema.sql`** (lines 342-350)  
    Defines `idempotency` table (legacy) and `idempotency_keys` table (used by enqueueJob).

16. **`db/rls.sql`** (lines 113-117)  
    RLS policy `ca_all` on `connected_accounts` checks `user_id = auth.uid()`.

17. **`supabase/migrations/20251123015000_connected_accounts_base.sql`** (lines 45-48)  
    Creates UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)`.

---

## E) Data Model & Storage Audit (Critical)

### E.1) `connected_accounts` Table

**Location:** `supabase/migrations/20251020043717_remote_schema.sql` (lines 286-299)

**Schema:**
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

**Indexes & Constraints:**
```sql
CREATE UNIQUE INDEX connected_accounts_provider_external_id_key 
  ON public.connected_accounts USING btree (provider, external_id);

CREATE UNIQUE INDEX connected_accounts_workspace_platform_key 
  ON public.connected_accounts USING btree (workspace_id, platform);
```

**CRITICAL FINDING:** The UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)` **prevents multiple accounts per workspace per platform**. This is the primary blocker for multi-account connection.

**NOTE:** The existing UNIQUE constraint on `(provider, external_id)` enforces global uniqueness, preventing the same external provider account from being connected to multiple workspaces. This constraint should be retained.

**Evidence of Single-Account Logic:**
- `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 76-82): Looks up existing account by `(workspace_id, platform)` and updates if found.
- `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts` (line 190): Uses `onConflict: "workspace_id,platform"` in upsert.

**RLS Policy:**
```sql
create policy "ca_all"
on "public"."connected_accounts"
as permissive
for all
to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));
```
Policy allows users to access their own connected accounts only.

**Service Role Policy:**
```sql
create policy "connected_accounts_service_role_full_access"
on "public"."connected_accounts"
as permissive
for all
to service_role
using (true)
with check (true);
```

### E.2) `publish_config` Table

**Location:** `supabase/migrations/20251124000000_add_publish_config.sql`

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS publish_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'twitter', 'facebook')),
  enabled boolean NOT NULL DEFAULT true,
  default_visibility text NOT NULL DEFAULT 'public' CHECK (default_visibility IN ('public', 'unlisted', 'private')),
  default_connected_account_ids uuid[] DEFAULT ARRAY[]::uuid[],
  title_template text NULL,
  description_template text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform)
);
```

**Multi-Account Support:** The `default_connected_account_ids uuid[]` array column supports multiple account IDs per platform. This is used by `scanSchedules` cron.

**RLS Policies:** NOT PROVABLE FROM REPO - No RLS policies found in migrations for `publish_config` table.

### E.3) `schedules` Table

**Location:** `supabase/migrations/20251020043717_remote_schema.sql` (lines 410-418), `supabase/migrations/20251201000000_add_platform_to_schedules.sql`

**Schema:**
```sql
create table "public"."schedules" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "clip_id" uuid not null,
    "run_at" timestamp with time zone not null,
    "status" text not null default 'scheduled'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);
```

**Platform Column:** Migration `20251201000000_add_platform_to_schedules.sql` adds `platform` column (nullable for backward compatibility).

**Account Selection:** Schedules do not store `connected_account_id` directly. Instead, `scanSchedules` reads `publish_config.default_connected_account_ids` for the schedule's platform and enqueues jobs for each account.

**RLS Policy:**
```sql
create policy "sch_all"
on "public"."schedules"
as permissive
for all
to public
using ((EXISTS (SELECT 1 FROM workspaces w WHERE w.id = schedules.workspace_id AND (w.owner_id = auth.uid() OR user_has_org_link(w.id)))))
with check ((EXISTS (SELECT 1 FROM workspaces w WHERE w.id = schedules.workspace_id AND (w.owner_id = auth.uid() OR user_has_org_link(w.id)))));
```

### E.4) `variant_posts` Table (Post Records)

**Location:** `supabase/migrations/20251123021611_viral_experiments.sql` (lines 33-45)

**Schema:**
```sql
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

**Per-Destination Tracking:** This table tracks posts per `clip_id` + `connected_account_id` + `platform`, enabling multi-account status tracking.

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_variant_posts_clip ON variant_posts(clip_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_account ON variant_posts(connected_account_id);
CREATE INDEX IF NOT EXISTS idx_variant_posts_variant_account ON variant_posts(variant_id, connected_account_id);
```

**RLS Policy:**
```sql
CREATE POLICY variant_posts_workspace_member_access
  ON variant_posts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM experiment_variants ev
      JOIN experiments e ON e.id = ev.experiment_id
      WHERE ev.id = variant_posts.variant_id
        AND (e.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM experiment_variants ev
      JOIN experiments e ON e.id = ev.experiment_id
      WHERE ev.id = variant_posts.variant_id
        AND (e.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    )
  );
```

### E.5) `idempotency_keys` Table

**Location:** `apps/web/supabase/migrations/20251020_baseline_schema.sql` (lines 33-41), `supabase/migrations/20251020043717_remote_schema.sql` (lines 233-259)

**Schema:**
```sql
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  route text not null,
  key_hash text not null,
  response jsonb,
  created_at timestamptz default now(),
  unique (workspace_id, route, key_hash)
);
```

**Usage:** `apps/web/src/lib/enqueueJob.ts` (lines 155-204) uses this table to prevent duplicate job enqueues. The `key_hash` is built from `kind`, `payload`, `runAt`, and `dedupeKey`.

---

## F) OAuth Connect Flows Audit (TikTok and YouTube separately)

### F.1) TikTok OAuth Flow

**Start Endpoint:** `apps/web/src/app/api/auth/tiktok/connect/route.ts`  
- Accepts `workspace_id` query param
- Builds TikTok OAuth URL with state containing `workspace_id`, `user_id`, `code_verifier`
- Redirects to TikTok authorization

**Callback Endpoint:** `apps/web/src/app/api/auth/tiktok/connect/callback/route.ts` (lines 55-239)
- Extracts `code` and `state` from query params
- Decodes state to get `workspace_id`, `user_id`
- Exchanges code for tokens via TikTok API
- Fetches user info to get `external_id`
- **Upserts connected account:**
  ```typescript
  await supabase.from("connected_accounts").upsert(
    {
      user_id,
      workspace_id,
      platform: "tiktok",
      provider: "tiktok",
      external_id: externalId,
      access_token_encrypted_ref: encryptSecret(tokenData.access_token, { purpose: "tiktok_token" }),
      refresh_token_encrypted_ref: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token, { purpose: "tiktok_token" }) : null,
      expires_at: expiresAt,
      scopes: tokenData.scope ? tokenData.scope.split(",") : [],
      status: "active",
    },
    { onConflict: "workspace_id,platform" }
  );
  ```

**CRITICAL:** The `onConflict: "workspace_id,platform"` enforces single account per workspace per platform. If a second TikTok account is connected, it will **overwrite** the first account.

**Token Storage:** Tokens stored in `access_token_encrypted_ref` and `refresh_token_encrypted_ref` columns.

**Refresh Strategy:** `apps/worker/src/jobs/refreshTikTokTokens.ts` (lines 38-142) - Cron job queries accounts with `expires_at <= threshold` and refreshes tokens.

### F.2) YouTube OAuth Flow

**Start Endpoint:** NOT PROVABLE FROM REPO - YouTube connect start endpoint not found in repository.

**Callback Endpoint:** `apps/web/src/app/api/auth/youtube/callback/route.ts` (lines 28-125)
- Extracts `code` and `state` from query params
- Decodes state to get `workspaceId`, `userId`
- Calls `completeYouTubeOAuthFlow()` from `youtubeOauthService`

**Service Layer:** `apps/web/src/lib/accounts/youtubeOauthService.ts` (lines 30-73)
- Exchanges code for tokens
- Fetches channel info
- Calls `connectedAccountsService.createOrUpdateConnectedAccount()`

**Upsert Logic:** `apps/web/src/lib/accounts/connectedAccountsService.ts` (lines 64-175)
- Looks up existing account by `(workspace_id, platform)` (line 77-82)
- If exists: updates (lines 115-133)
- If not: creates (lines 134-152)

**CRITICAL:** Same single-account limitation as TikTok. The lookup by `(workspace_id, platform)` assumes only one account exists.

**Token Storage:** Tokens stored via `createOrUpdateConnectedAccount()` which sets `access_token_encrypted_ref` and `refresh_token_encrypted_ref`.

**Refresh Strategy:** NOT PROVABLE FROM REPO - YouTube token refresh job/cron not found in repository.

---

## G) Publish & Job Pipeline Audit (TikTok and YouTube separately)

### G.1) TikTok Publish Flow

**Publish Endpoint:** `apps/web/src/pages/api/publish/tiktok.ts`

**Request Body Schema:** `packages/shared/src/schemas.ts` (lines 139-156)
```typescript
export const PublishTikTokInput = z.object({
  clipId: z.string().uuid(),
  connectedAccountId: z.string().uuid().optional(), // Single account (backward compatibility)
  connectedAccountIds: z.array(z.string().uuid()).optional(), // Multi-account support
  caption: z.string().max(2200).optional(),
  privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIEND', 'SELF_ONLY']).optional(),
  experimentId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
});
```

**Account Resolution:** Lines 267-312
```typescript
const requestedAccountIds: string[] =
  payload.connectedAccountIds || (payload.connectedAccountId ? [payload.connectedAccountId] : []);

const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
  {
    workspaceId,
    platform: 'tiktok',
    connectedAccountIds: requestedAccountIds.length > 0 ? requestedAccountIds : undefined,
  },
  { supabase: supabaseClientForQueries },
);

resolvedAccountIds = accounts.map((a: any) => a.id);
```

**Job Creation (Fan-Out):** Lines 479-507
```typescript
const jobsPayload = resolvedAccountIds.map((accountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_TIKTOK',
  status: 'queued',
  idempotency_key: idempotencyKey,
  payload: {
    clipId: payload.clipId,
    storagePath,
    connectedAccountId: accountId, // Single account per job
    caption: payload.caption,
    privacyLevel: payload.privacyLevel,
    experimentId: payload.experimentId ?? null,
    variantId: payload.variantId ?? null,
  },
  created_by: userId,
}));

const { data, error } = await admin.from('jobs').insert(jobsPayload).select('id');
```

**Job Payload Schema:** `packages/shared/src/schemas/jobs.ts` (line 53+)
```typescript
export const PUBLISH_TIKTOK = z.object({
  clipId: z.string().uuid(),
  storagePath: z.string(),
  connectedAccountId: z.string().uuid(), // Single account per job
  caption: z.string().optional(),
  privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIEND', 'SELF_ONLY']).optional(),
  experimentId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
});
```

**Worker Pipeline:** `apps/worker/src/pipelines/publish-tiktok.ts` (lines 34-470)
- Parses `PUBLISH_TIKTOK` payload
- Fetches clip and connected account
- Checks `variant_posts` for idempotency per account (lines 93-113)
- Downloads clip, gets fresh token, uploads to TikTok
- Updates `variant_posts` after successful publish (lines 326-349)

**Idempotency:** Uses `variant_posts` table to check if `(clip_id, connected_account_id, platform='tiktok')` already exists with `status='posted'`.

### G.2) YouTube Publish Flow

**Publish Endpoint:** `apps/web/src/pages/api/publish/youtube.ts`

**Request Body Schema:** `packages/shared/src/schemas.ts` (lines 122-135)
```typescript
export const PublishYouTubeInput = z.object({
  clipId: z.string().uuid(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  scheduleAt: z.string().datetime({ offset: true }).optional(),
  accountId: z.string().min(1).optional(),
  titleOverride: z.string().max(120).optional(),
  descriptionOverride: z.string().max(5000).optional(),
  experimentId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  connectedAccountIds: z.array(z.string().uuid()).optional(), // For multi-account posting
});
```

**Account Resolution:** Lines 278-327
```typescript
const requestedAccountIds: string[] = Array.isArray(payload.connectedAccountIds)
  ? payload.connectedAccountIds
  : [];

const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
  {
    workspaceId,
    platform: 'youtube',
    connectedAccountIds: requestedAccountIds.length > 0 ? requestedAccountIds : undefined,
  },
  { supabase: supabaseClientForQueries },
);

resolvedAccountIds = accounts.map((a: any) => a.id);
```

**Job Creation (Fan-Out):** Lines 493-523
```typescript
const jobsPayload = resolvedAccountIds.map((accountId) => ({
  workspace_id: workspaceId,
  kind: 'PUBLISH_YOUTUBE',
  status: 'queued',
  idempotency_key: idempotencyKey,
  payload: {
    clipId: payload.clipId,
    storagePath,
    connectedAccountId: accountId, // Single account per job
    title: payload.title,
    description: payload.description,
    privacy: payload.privacy,
    experimentId: payload.experimentId ?? null,
    variantId: payload.variantId ?? null,
  },
  created_by: userId,
}));

const { data, error } = await admin.from('jobs').insert(jobsPayload).select('id');
```

**Job Payload Schema:** `packages/shared/src/schemas/jobs.ts` (line 39+)
```typescript
export const PUBLISH_YOUTUBE = z.object({
  clipId: z.string().uuid(),
  storagePath: z.string(),
  connectedAccountId: z.string().uuid(), // Single account per job
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  experimentId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
});
```

**Worker Pipeline:** `apps/worker/src/pipelines/publish-youtube.ts` (lines 40-337)
- Parses `PUBLISH_YOUTUBE` payload
- Fetches clip and connected account
- Checks `variant_posts` for idempotency per account (lines 81-104)
- Downloads clip, gets fresh token, uploads to YouTube
- Updates `variant_posts` after successful publish (lines 225-246)

**Idempotency:** Uses `variant_posts` table to check if `(clip_id, connected_account_id, platform='youtube_shorts')` already exists with `status='posted'`.

### G.3) Cron `scanSchedules` Flow

**Location:** `apps/web/src/lib/cron/scanSchedules.ts` (lines 32-282)

**Account Resolution:** Lines 146-185
```typescript
// Try to get accounts from publish_config first
const publishConfig = await publishConfigService.getPublishConfig(
  {
    workspaceId: schedule.workspace_id,
    platform: schedule.platform as "tiktok" | "youtube",
  },
  { supabase },
);

// Use default accounts from config if available
if (
  publishConfig.default_connected_account_ids &&
  publishConfig.default_connected_account_ids.length > 0
) {
  const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
    {
      workspaceId: schedule.workspace_id,
      platform: schedule.platform as "tiktok" | "youtube",
      connectedAccountIds: publishConfig.default_connected_account_ids,
    },
    { supabase },
  );
  accountIds = accounts.map((a) => a.id);
} else {
  // Fall back to all active accounts for platform
  const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
    {
      workspaceId: schedule.workspace_id,
      platform: schedule.platform as "tiktok" | "youtube",
    },
    { supabase },
  );
  accountIds = accounts.map((a) => a.id);
}
```

**Job Enqueue (Fan-Out):** Lines 211-250
```typescript
// Enqueue one job per account
for (const accountId of accountIds) {
  const payload: Record<string, unknown> = {
    clipId: schedule.clip_id,
    connectedAccountId: accountId,
  };

  const result = await enqueueJob({
    workspaceId: schedule.workspace_id,
    kind: jobKind, // "PUBLISH_TIKTOK" or "PUBLISH_YOUTUBE"
    payload,
    dedupeKey: `${schedule.id}-${accountId}`, // Ensures idempotency per schedule+account
  });
}
```

**Multi-Account Support:** Cron supports fan-out via `publish_config.default_connected_account_ids` array.

---

## H) Fan-Out Capability Audit (Answer Explicitly)

### H.1) TikTok Fan-Out

**Q: Can one clip be published to multiple connected accounts in one request?**  
**A: YES** - The publish endpoint accepts `connectedAccountIds[]` array and creates one job per account.

**Evidence:**
- `apps/web/src/pages/api/publish/tiktok.ts` (lines 267-312): Resolves `connectedAccountIds` array
- Lines 479-507: Maps `resolvedAccountIds` to create N jobs (one per account)

**Q: Can scheduling/cron produce multiple jobs for multiple accounts?**  
**A: YES** - `scanSchedules` reads `publish_config.default_connected_account_ids` and enqueues one job per account.

**Evidence:**
- `apps/web/src/lib/cron/scanSchedules.ts` (lines 146-185): Reads `publish_config.default_connected_account_ids`
- Lines 211-250: Loops through `accountIds` and enqueues one job per account with `dedupeKey: ${schedule.id}-${accountId}`

**Q: How is each destination tracked?**  
**A: Via `variant_posts` table** - Each job creates/updates a `variant_posts` record with `(clip_id, connected_account_id, platform='tiktok')`.

**Evidence:**
- `apps/worker/src/pipelines/publish-tiktok.ts` (lines 326-349): Updates `variant_posts` after successful publish
- `variant_posts` table has `connected_account_id` column for per-account tracking

**Limitation:** Fan-out works **only if multiple accounts exist**. The UNIQUE constraint on `connected_accounts(workspace_id, platform)` prevents multiple accounts from being stored.

### H.2) YouTube Fan-Out

**Q: Can one clip be published to multiple connected accounts in one request?**  
**A: YES** - Same pattern as TikTok.

**Evidence:**
- `apps/web/src/pages/api/publish/youtube.ts` (lines 278-327): Resolves `connectedAccountIds` array
- Lines 493-523: Maps `resolvedAccountIds` to create N jobs (one per account)

**Q: Can scheduling/cron produce multiple jobs for multiple accounts?**  
**A: YES** - Same pattern as TikTok.

**Evidence:**
- `apps/web/src/lib/cron/scanSchedules.ts` (lines 146-250): Same logic for both platforms

**Q: How is each destination tracked?**  
**A: Via `variant_posts` table** - Same pattern as TikTok, with `platform='youtube_shorts'`.

**Evidence:**
- `apps/worker/src/pipelines/publish-youtube.ts` (lines 225-246): Updates `variant_posts` after successful publish

**Limitation:** Same as TikTok - UNIQUE constraint prevents multiple accounts.

---

## I) End-to-End Flow Readiness (Evidence Map)

| Stage | Status | Evidence |
|-------|--------|----------|
| **Input/Ingestion** | ✅ **IMPLEMENTED** | Upload endpoints exist (not in scope, but referenced in worker pipelines) |
| **Storage Model for Sources** | ✅ **IMPLEMENTED** | `clips` table with `workspace_id`, `status`, `storage_path` |
| **Clip Generation Jobs** | ✅ **IMPLEMENTED** | `CLIP_RENDER` job kind, worker pipeline exists |
| **Clip Status Lifecycle** | ✅ **IMPLEMENTED** | `clips.status` enum: `'proposed','approved','rejected','rendering','ready','published','failed'` |
| **Publish Selection Mechanism** | ✅ **IMPLEMENTED** | `connectedAccountIds[]` in request, `publish_config.default_connected_account_ids` for cron |
| **Publish Execution Path** | ✅ **IMPLEMENTED** | `PUBLISH_TIKTOK` and `PUBLISH_YOUTUBE` worker pipelines |
| **Post Status Updates** | ✅ **IMPLEMENTED** | `variant_posts` table updated after publish with `platform_post_id`, `status='posted'` |
| **Retries/DLQ Behavior** | ⚠️ **PARTIAL** | Jobs have `attempts`, `max_attempts`, `status='failed'`, but explicit DLQ table/queue not found |
| **Audit Logging / Observability** | ✅ **IMPLEMENTED** | `events_audit` table, structured logging throughout |

**Missing Links:**
- Explicit DLQ table/queue (jobs with `status='failed'` after `max_attempts` are not moved to separate DLQ table)
- YouTube token refresh cron job (TikTok has `refreshTikTokTokensJob()`, YouTube equivalent not found)

---

## J) Gaps & Required Changes Map (No Code)

### Critical Blockers

1. **Database Constraint Blocks Multi-Account Connection**
   - **Finding:** UNIQUE constraint `connected_accounts_workspace_platform_key` on `(workspace_id, platform)` prevents multiple accounts per workspace per platform.
   - **Impact:** Users cannot connect multiple TikTok or YouTube accounts to the same workspace.
   - **Required Change:** Remove UNIQUE constraint on `(workspace_id, platform)` to allow multiple accounts per workspace per platform. Retain UNIQUE constraint on `(provider, external_id)` to enforce global uniqueness (prevent same external account in multiple workspaces).

2. **OAuth Callback Upsert Logic Assumes Single Account**
   - **Finding:** TikTok callback uses `onConflict: "workspace_id,platform"`, YouTube service looks up by `(workspace_id, platform)` and updates if found.
   - **Impact:** If constraint is removed, second account connection will overwrite first account. Additionally, if same external account is already connected to a different workspace, connection should be blocked.
   - **Required Change:** Modify upsert logic to: (1) Check if account with same `(provider, external_id)` exists in a different workspace - if so, block and return error; (2) If same `(provider, external_id)` exists in same workspace, update tokens; (3) If `external_id` differs, create new account record. Use `(provider, external_id)` as conflict target for global uniqueness enforcement.

### Partial Implementations

3. **RLS Policies for `publish_config`**
   - **Finding:** `publish_config` table exists but RLS policies not found in migrations.
   - **Impact:** Potential security gap if RLS is enabled without policies.
   - **Required Change:** Add RLS policies for `publish_config` table to enforce workspace isolation.

4. **DLQ Table/Queue**
   - **Finding:** Jobs with `status='failed'` after `max_attempts` remain in `jobs` table, no explicit DLQ table.
   - **Impact:** Failed jobs are not easily queryable for recovery/debugging.
   - **Required Change:** Add DLQ table or query pattern to identify failed jobs for recovery.

5. **YouTube Token Refresh**
   - **Finding:** TikTok has `refreshTikTokTokensJob()` cron, YouTube equivalent not found.
   - **Impact:** YouTube tokens may expire without automatic refresh.
   - **Required Change:** Add YouTube token refresh cron job similar to TikTok.

### Enhancement Opportunities

6. **Account Listing Endpoint**
   - **Finding:** `connectedAccountsService.listConnectedAccounts()` exists but API endpoint not found.
   - **Impact:** Frontend may not have direct API to list accounts.
   - **Required Change:** Add API endpoint `/api/accounts` or `/api/connected-accounts` to list accounts.

7. **Account Status Management**
   - **Finding:** `updateConnectedAccountStatus()` exists but API endpoint not found.
   - **Impact:** Users cannot revoke/disable accounts via API.
   - **Required Change:** Add API endpoint to update account status.

---

## K) Blast Radius Map (Read-Only)

**Categories that will be touched to implement full multi-account support:**

1. **DB Migrations**
   - Remove/modify `connected_accounts_workspace_platform_key` UNIQUE constraint
   - Add RLS policies for `publish_config` (if missing)
   - Consider adding `display_name` or `account_name` column to `connected_accounts` for user-friendly identification

2. **RLS Policies**
   - Verify `connected_accounts` policies work with multiple accounts per workspace
   - Add `publish_config` RLS policies
   - Ensure `variant_posts` policies allow access to all posts for workspace members

3. **API Routes**
   - Modify TikTok OAuth callback to use `(provider, external_id)` conflict target and block if account exists in different workspace
   - Modify YouTube OAuth service to check for existing account in different workspace and block with error if found
   - Add account listing endpoint (`/api/accounts` or `/api/connected-accounts`)
   - Add account status management endpoint

4. **Cron**
   - Add YouTube token refresh cron job
   - Verify `scanSchedules` works correctly with multiple accounts (already supports via `publish_config`)

5. **Jobs Schema**
   - No changes needed - job payload already supports single `connectedAccountId` per job

6. **Publish Handlers**
   - No changes needed - already support fan-out via `connectedAccountIds[]` array

7. **Tests**
   - Add tests for multiple account connection (currently blocked by constraint)
   - Add tests for fan-out publishing with multiple accounts
   - Add tests for account listing and status management

8. **Docs**
   - Update API docs to reflect multi-account support
   - Document `publish_config.default_connected_account_ids` usage

---

## L) Summary: What Has Been Built

### ✅ Fully Implemented

1. **Publish Fan-Out Logic**
   - Both TikTok and YouTube publish endpoints accept `connectedAccountIds[]` array
   - Endpoints create one job per account in a loop
   - Cron `scanSchedules` supports multi-account via `publish_config.default_connected_account_ids`

2. **Per-Account Post Tracking**
   - `variant_posts` table tracks posts per `(clip_id, connected_account_id, platform)`
   - Worker pipelines update `variant_posts` after successful publish
   - Idempotency checks use `variant_posts` to prevent duplicate posts per account

3. **Job Pipeline Architecture**
   - One job per account strategy (N jobs for N accounts)
   - Job payload includes single `connectedAccountId`
   - Worker pipelines handle single account per job

4. **Publish Config**
   - `publish_config` table with `default_connected_account_ids uuid[]` array
   - Service layer `publishConfigService` for reading/updating config
   - Cron uses config to determine which accounts to publish to

5. **Idempotency**
   - `idempotency_keys` table used by `enqueueJob()`
   - Per-account idempotency via `variant_posts` checks in worker pipelines
   - Cron uses `dedupeKey: ${schedule.id}-${accountId}` for schedule-level idempotency

6. **Token Management**
   - Tokens stored in `access_token_encrypted_ref` and `refresh_token_encrypted_ref`
   - TikTok token refresh cron job exists
   - Token expiry tracking via `expires_at` column

### ⚠️ Partially Implemented

1. **Account Connection (OAuth)**
   - OAuth flows exist for both platforms
   - Token storage and refresh implemented
   - **BLOCKER:** UNIQUE constraint prevents multiple accounts per workspace per platform

2. **Account Listing**
   - Service layer `listConnectedAccounts()` exists
   - API endpoint not found (may exist but not in scope of search)

3. **RLS Policies**
   - `connected_accounts` has RLS policy
   - `publish_config` RLS policies not found
   - `variant_posts` has RLS policy

### ❌ Not Implemented / Missing

1. **Multiple Account Storage**
   - Database constraint blocks multiple accounts per workspace per platform
   - OAuth callback logic overwrites existing account (needs to check for different workspace and block)

2. **YouTube Token Refresh**
   - Cron job not found (TikTok has one)

3. **Explicit DLQ Table**
   - Failed jobs remain in `jobs` table, no separate DLQ table

---

**End of Audit Report**
