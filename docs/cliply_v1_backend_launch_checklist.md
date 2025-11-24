# Cliply V1 Backend Launch Checklist

**Date:** 2025-01-XX  
**Purpose:** Complete operational guide for launching Cliply V1 backend to production

---

## 1. High-Level Overview

### What Cliply V1 Backend Already Does

Cliply V1 backend is a complete AI-powered clipping and publishing platform with the following capabilities:

**Core Pipelines (End-to-End):**
- ✅ **Upload & Ingest**: File uploads and YouTube URL imports
- ✅ **Processing Pipeline**: Transcription → Highlight Detection → Clip Rendering → Thumbnail Generation
- ✅ **Multi-Account Publishing**: Publish clips to multiple YouTube channels and TikTok accounts
- ✅ **Viral Experiment Engine**: A/B testing framework with variants, variant_posts, and metrics tracking
- ✅ **Usage Limits & Enforcement**: Per-workspace plan limits (source_minutes, clips, projects) enforced at API and pipeline boundaries
- ✅ **YouTube OAuth & Publishing**: Complete OAuth flow and YouTube Shorts publishing with token refresh
- ✅ **TikTok OAuth & Publishing**: Complete OAuth flow and TikTok video publishing with token refresh
- ✅ **Health & Readiness**: `/api/healthz`, `/api/readyz`, and worker `readyz` CLI for orchestration

**Infrastructure:**
- ✅ Queue-based job processing via Supabase jobs table
- ✅ Supabase Storage for videos, renders, thumbnails, transcripts
- ✅ Workspace-scoped multi-tenancy with RLS policies
- ✅ Structured logging and error handling
- ✅ Rate limiting on critical endpoints

### What Is Explicitly Out-of-Scope for V1 Launch

The following features are **not required** for initial launch but may be added later:

- ✅ **TikTok API Client**: TikTok publishing pipeline fully implemented with real API integration
- ❌ **Automated Metrics Ingestion**: No continuous syncing of YouTube/TikTok analytics (metrics must be pushed via API)
- ❌ **Advanced Viral Automation**: No auto-delete/repost for underperforming variants, no automated winner selection
- ❌ **Instagram Integration**: Not in V1 scope
- ❌ **Full Test Harness Cleanup**: Some test utilities may still require manual env setup

---

## 2. Environments & Configuration

### Environment Variables Reference

All environment variables are centralized in `packages/shared/src/env.ts` with Zod validation. The application will fail fast if required variables are missing.

#### Required for Web/API (`apps/web`)

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (for client-side) | Supabase Dashboard → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) | Supabase Dashboard → Settings → API → service_role key (⚠️ keep secret) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Same as above (⚠️ keep secret) |
| `YOUTUBE_OAUTH_REDIRECT_URL` | OAuth callback URL | Your domain + `/api/oauth/google/callback` (e.g., `https://api.cliply.com/api/oauth/google/callback`) |
| `TIKTOK_CLIENT_ID` | TikTok OAuth client key | TikTok Developer Portal → Your App → Client Key |
| `TIKTOK_CLIENT_SECRET` | TikTok OAuth client secret | TikTok Developer Portal → Your App → Client Secret (⚠️ keep secret) |
| `TIKTOK_OAUTH_REDIRECT_URL` | TikTok OAuth callback URL | Your domain + `/api/auth/tiktok/connect/callback` (e.g., `https://api.cliply.com/api/auth/tiktok/connect/callback`) |

#### Required for Worker (`apps/worker`)

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `SUPABASE_URL` | Same as above | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above | Same as above |

#### Optional (All Services)

| Variable | Description | Default | Where to Get It |
|----------|-------------|---------|-----------------|
| `NODE_ENV` | Environment mode | `development` | Set to `production` in prod |
| `SENTRY_DSN` | Sentry error tracking DSN | `""` (disabled) | Sentry Dashboard → Project Settings → Client Keys (DSN) |
| `DEEPGRAM_API_KEY` | Deepgram transcription API key | Not required if using Whisper | Deepgram Dashboard → API Keys |
| `STRIPE_SECRET_KEY` | Stripe secret key (for billing) | Not required for V1 | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | Not required for V1 | Stripe Dashboard → Webhooks → Signing secret |
| `WORKER_POLL_MS` | Worker poll interval (ms) | Default in code | Optional tuning |
| `WORKER_HEARTBEAT_MS` | Worker heartbeat interval (ms) | Default in code | Optional tuning |
| `LOG_SAMPLE_RATE` | Log sampling rate (0-1) | `1` (all logs) | Optional for cost control |

### Environment-Specific Notes

#### Local Development

- Use `.env.local` files in each app (`apps/web/.env.local`, `apps/worker/.env.local`)
- Or use a shared `.env` file at the repo root (if using a tool like `dotenv-cli`)
- For local Supabase: Use `supabase start` and copy values from `supabase status`
- OAuth redirect URLs should point to `http://localhost:3000` (or your local port)

#### Staging

- Use a separate Supabase project (create via Supabase Dashboard)
- OAuth redirect URLs must match staging domain (e.g., `https://staging-api.cliply.com/api/oauth/google/callback`)
- Use staging OAuth apps in Google Cloud Console and TikTok Developer Portal
- All env vars should be set in your deployment platform (Vercel, Fly.io, Railway, etc.)

#### Production

- Use production Supabase project
- OAuth redirect URLs must match production domain (e.g., `https://api.cliply.com/api/oauth/google/callback`)
- Use production OAuth apps (separate from staging)
- **Critical**: Never commit `.env` files or expose service role keys
- Use secrets management (e.g., Vercel Environment Variables, AWS Secrets Manager, etc.)

---

## 3. Supabase Setup

### Step-by-Step Checklist

#### 3.1 Database Migrations

- [ ] **Create Supabase project** (staging and/or production)
- [ ] **Apply all migrations** in `supabase/migrations/` in chronological order:
  - [ ] `20240000000000_fix_moddatetime.sql`
  - [ ] `20240000000001_workspace_id_helper.sql`
  - [ ] `20250101000000_rls_workspaces_members.sql`
  - [ ] `20250101000001_jobs_table.sql`
  - [ ] `20250101000002_job_events_table.sql`
  - [ ] `20250101000003_idempotency_keys_table.sql`
  - [ ] `20250101000004_rls_jobs_policies.sql`
  - [ ] `20250101000005_rls_idempotency_policies.sql`
  - [ ] `20250101000006_worker_claim_next_job_rpc.sql`
  - [ ] `20250101000007_rls_service_role_full_access.sql`
  - [ ] `20251020000000_idempotency_unique.sql`
  - [ ] `20251020043717_remote_schema.sql`
  - [ ] `20251020044441_fix_jobs_state_check.sql`
  - [ ] `20251022000100_add_state_column_to_jobs.sql`
  - [ ] `20251022001000_rls_jobs_owner_check_text.sql`
  - [ ] `20251022002000_rls_jobs_owner_check_strict_text.sql`
  - [ ] `20251022003000_rls_jobs_policy_minimal.sql`
  - [ ] `20251022004000_rls_jobs_policy_no_cast_error.sql`
  - [ ] `20251107181814_add_worker_finish_and_job_events.sql`
  - [ ] `20251123000000_workspace_usage.sql`
  - [ ] `20251123000001_increment_workspace_usage_rpc.sql`
  - [ ] `20251123021611_viral_experiments.sql`
  - [ ] `20251123022358_add_experiment_columns_to_clips.sql`
  - [ ] `20251123022400_add_connected_accounts_fields.sql`
  - [ ] `20251124000000_add_publish_config.sql`
  - [ ] `20251125000000_add_youtube_oauth_fields_to_connected_accounts.sql`
  - [ ] `20251126000000_add_plan_to_workspaces.sql`

**How to apply:**
- **Via Supabase CLI**: `supabase db push` (if linked to project)
- **Via Supabase Dashboard**: SQL Editor → paste migration SQL → Run
- **Via migration tool**: Use your CI/CD pipeline or migration runner

- [ ] **Verify tables exist**: Check that `workspaces`, `workspace_members`, `jobs`, `projects`, `clips`, `connected_accounts`, `publish_config`, `experiments`, `experiment_variants`, `variant_posts`, `variant_metrics`, `workspace_usage` all exist

#### 3.2 Storage Buckets

Create the following storage buckets in Supabase Dashboard → Storage:

- [ ] **`videos`** bucket
  - **Purpose**: Store original uploaded source videos
  - **Public**: No (private)
  - **File size limit**: 2GB (configure in bucket settings)
  - **Allowed MIME types**: `video/mp4`, `video/quicktime`, `video/x-matroska`, `video/webm`

- [ ] **`transcripts`** bucket
  - **Purpose**: Store transcription files (SRT and JSON)
  - **Public**: No (private)
  - **File size limit**: 10MB (transcripts are small)

- [ ] **`renders`** bucket
  - **Purpose**: Store rendered clip videos
  - **Public**: No (private)
  - **File size limit**: 500MB per clip

- [ ] **`thumbs`** bucket
  - **Purpose**: Store thumbnail images
  - **Public**: No (private, but you may want public signed URLs for frontend)
  - **File size limit**: 5MB per thumbnail

**Note**: The code will attempt to auto-create buckets if they don't exist (see `apps/web/src/lib/storage.ts`), but it's safer to create them manually in production.

#### 3.3 Storage Webhook Configuration

Configure Supabase Storage webhook to call your API when files are uploaded:

- [ ] **Create webhook** in Supabase Dashboard → Database → Webhooks
  - **Name**: `storage-upload-webhook`
  - **Table**: `storage.objects` (or use Supabase Storage webhook feature if available)
  - **Events**: `INSERT` (when new files are uploaded)
  - **HTTP Request**:
    - **URL**: `https://your-api-domain.com/api/webhooks/storage` (staging/prod URL)
    - **Method**: `POST`
    - **Headers**: 
      - `Content-Type: application/json`
      - (Optional) Add a secret header for webhook verification if you implement it
  - **Payload**: Use default Supabase webhook payload format

**Alternative**: If Supabase doesn't support storage webhooks directly, you can:
- Use a database trigger on `storage.objects` table (if accessible)
- Or manually trigger transcription via API after upload completes

**Webhook Endpoint**: `/api/webhooks/storage` (see `apps/web/src/pages/api/webhooks/storage.ts`)
- Handles uploads to `videos` bucket only
- Parses path: `{workspaceId}/{projectId}/source.{ext}`
- Enqueues `TRANSCRIBE` job if project is in `queued` status
- Idempotent (skips if job already exists)

#### 3.4 RLS & Service Roles

- [ ] **Verify RLS policies** are enabled on all tables (migrations should have done this)
- [ ] **Service role key** is used by:
  - Worker (bypasses RLS to process jobs)
  - API for admin operations (storage, job creation)
- [ ] **Anon key** is used by:
  - Frontend client (with RLS enforcing workspace membership)
- [ ] **Test RLS**: Create a test workspace and verify users can only see their own workspace data

---

## 4. OAuth Providers

### 4.1 YouTube / Google OAuth

#### Where to Create OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **YouTube Data API v3**:
   - APIs & Services → Library → Search "YouTube Data API v3" → Enable
4. Create OAuth 2.0 credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Web application**
   - Name: `Cliply YouTube OAuth` (or similar)

#### Required Redirect URLs

Add the following **Authorized redirect URIs**:

- **Staging**: `https://staging-api.cliply.com/api/oauth/google/callback`
- **Production**: `https://api.cliply.com/api/oauth/google/callback`
- **Local Dev** (optional): `http://localhost:3000/api/oauth/google/callback`

**Important**: The redirect URL must match exactly (including protocol, domain, and path).

#### Required Scopes

Enable the following OAuth scopes in your OAuth consent screen:

- `https://www.googleapis.com/auth/youtube.upload` (upload videos)
- `https://www.googleapis.com/auth/youtube.readonly` (read channel info)
- `https://www.googleapis.com/auth/userinfo.email` (get user email)
- `https://www.googleapis.com/auth/userinfo.profile` (get user profile)

**OAuth Consent Screen**:
- Configure consent screen (Internal or External)
- Add scopes listed above
- Add test users if in testing mode

#### Environment Variables to Set

Copy these values into your environment:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
YOUTUBE_OAUTH_REDIRECT_URL=https://api.cliply.com/api/oauth/google/callback
```

#### OAuth Flow Routes

- **Start**: `GET /api/oauth/google/start` (requires auth, returns OAuth URL)
- **Callback**: `GET /api/oauth/google/callback` (called by Google, no auth required)

**Testing**:
- [ ] Test OAuth flow in staging
- [ ] Verify tokens are stored in `connected_accounts` table
- [ ] Verify channel info is fetched and stored

### 4.2 TikTok OAuth

#### Where to Create OAuth Client

1. Go to [TikTok Developer Portal](https://developers.tiktok.com/)
2. Create a new app (or use existing)
3. Configure app settings:
   - **App Type**: Web App
   - **Redirect URI**: Your callback URL (see below)

#### Required Redirect URLs

Add the following **Redirect URIs** in TikTok Developer Portal:

- **Staging**: `https://staging-api.cliply.com/api/auth/tiktok/connect/callback`
- **Production**: `https://api.cliply.com/api/auth/tiktok/connect/callback`
- **Local Dev** (optional): `http://localhost:3000/api/auth/tiktok/connect/callback`

**Note**: TikTok uses `client_key` (not `client_id`) in their API, but we map it to `TIKTOK_CLIENT_ID` in env.

#### Required Scopes / Permissions

Request the following scopes in your OAuth flow:

- `user.info.basic` (get user info)
- `video.upload` (upload videos)

**Important**: TikTok publishing is **fully implemented** in V1. The OAuth flow works, and the `PUBLISH_TIKTOK` pipeline uploads videos to TikTok using the Content Posting API.

#### Environment Variables to Set

Copy these values into your environment:

```bash
TIKTOK_CLIENT_ID=your-client-key
TIKTOK_CLIENT_SECRET=your-client-secret
TIKTOK_OAUTH_REDIRECT_URL=https://api.cliply.com/api/auth/tiktok/connect/callback
```

**Note**: The code also references `TIKTOK_CLIENT_KEY` in some places (legacy), but `TIKTOK_CLIENT_ID` is the canonical name in `env.ts`.

#### OAuth Flow Routes

- **Start**: `GET /api/auth/tiktok/connect` (App Router) or `GET /api/auth/tiktok_legacy` (Pages Router)
- **Callback**: `GET /api/auth/tiktok/connect/callback` (App Router)

**Testing**:
- [ ] Test OAuth flow in staging
- [ ] Verify tokens are stored in `connected_accounts` table
- [ ] Test publishing flow (see Section 8 for details)

---

## 5. Health & Readiness Wiring

### 5.1 Web/API Endpoints

#### `/api/healthz` (Lightweight Health Check)

**Purpose**: Simple uptime check (does not check dependencies)

**Endpoint**: `GET /api/healthz`

**Response**:
```json
{
  "ok": true,
  "service": "api",
  "ts": "2025-01-XXT..."
}
```

**Usage**: Use for basic uptime monitoring (e.g., Pingdom, UptimeRobot)

**Example**:
```bash
curl https://api.cliply.com/api/healthz
```

#### `/api/readyz` (Readiness Check)

**Purpose**: Checks if API is ready to serve traffic (checks env vars and DB connectivity)

**Endpoint**: `GET /api/readyz`

**Response** (success):
```json
{
  "ok": true,
  "service": "api",
  "checks": {
    "env": true,
    "db": true
  },
  "ts": "2025-01-XXT..."
}
```

**Response** (failure):
```json
{
  "ok": false,
  "service": "api",
  "checks": {
    "env": false,
    "db": false
  },
  "errors": {
    "env": "Missing: SUPABASE_URL",
    "db": "connection_failed"
  },
  "ts": "2025-01-XXT..."
}
```

**HTTP Status**: `200` if ready, `503` if not ready

**Usage**: 
- **Load balancer health check**: Configure your load balancer (AWS ALB, GCP LB, etc.) to call `/api/readyz` and route traffic only if it returns `200`
- **Kubernetes readiness probe**: Use in `readinessProbe` configuration
- **Docker Compose**: Use in healthcheck configuration

**Example**:
```bash
curl https://api.cliply.com/api/readyz
```

**Integration Example (Kubernetes)**:
```yaml
readinessProbe:
  httpGet:
    path: /api/readyz
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

### 5.2 Worker Readiness CLI

**Purpose**: Check if worker is ready to process jobs (checks env vars, DB, and queue access)

**Command**: `pnpm -C apps/worker readyz`

**Output** (success):
```json
{
  "ok": true,
  "service": "worker",
  "checks": {
    "env": true,
    "db": true,
    "queue": true
  },
  "ts": "2025-01-XXT..."
}
```

**Output** (failure):
```json
{
  "ok": false,
  "service": "worker",
  "checks": {
    "env": false,
    "db": false,
    "queue": false
  },
  "errors": {
    "env": "Missing: SUPABASE_SERVICE_ROLE_KEY",
    "db": "timeout"
  },
  "ts": "2025-01-XXT..."
}
```

**Exit Code**: `0` if ready, `1` if not ready

**Usage**:
- **Process manager**: Use in systemd, PM2, or similar to check worker health
- **Container orchestrator**: Use as readiness probe command
- **CI/CD**: Use to verify worker can start before deployment

**Example (Docker)**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD pnpm -C apps/worker readyz || exit 1
```

**Example (systemd)**:
```ini
[Service]
ExecStart=/usr/bin/pnpm -C /app/apps/worker readyz
Restart=on-failure
```

**Example (Kubernetes)**:
```yaml
readinessProbe:
  exec:
    command:
      - pnpm
      - -C
      - apps/worker
      - readyz
  initialDelaySeconds: 10
  periodSeconds: 5
```

---

## 6. First Real Client Onboarding Checklist

This is a **literal, step-by-step checklist** to onboard your first paying client. Follow in order.

### Pre-Launch (Infrastructure)

- [ ] **Create Supabase project for staging**
  - [ ] Copy project URL and keys
  - [ ] Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in staging env

- [ ] **Run all migrations** (see Section 3.1)
  - [ ] Verify all tables exist
  - [ ] Verify RLS policies are enabled

- [ ] **Create storage buckets** (see Section 3.2)
  - [ ] `videos`
  - [ ] `transcripts`
  - [ ] `renders`
  - [ ] `thumbs`

- [ ] **Configure storage webhook** (see Section 3.3)
  - [ ] Set webhook URL to staging API endpoint
  - [ ] Test webhook by uploading a test file

- [ ] **Set all required env vars for staging API** (see Section 2)
  - [ ] Supabase keys
  - [ ] Google OAuth credentials (staging)
  - [ ] TikTok OAuth credentials (staging)
  - [ ] OAuth redirect URLs (staging domain)

- [ ] **Set all required env vars for staging worker**
  - [ ] Supabase keys (same as API)

- [ ] **Deploy API to staging**
  - [ ] Verify `/api/healthz` returns 200
  - [ ] Verify `/api/readyz` returns 200

- [ ] **Deploy worker to staging**
  - [ ] Verify `pnpm -C apps/worker readyz` exits with code 0
  - [ ] Verify worker can poll jobs table

### Staging Testing (End-to-End)

- [ ] **Connect a test YouTube account in staging**
  - [ ] Call `GET /api/oauth/google/start` (or use frontend)
  - [ ] Complete OAuth flow
  - [ ] Verify account appears in `connected_accounts` table
  - [ ] Verify token refresh works (wait for expiry or manually test)

- [ ] **Upload a test video via file**
  - [ ] Call `POST /api/upload/init` with file metadata
  - [ ] Upload file to signed URL
  - [ ] Verify webhook triggers and `TRANSCRIBE` job is created
  - [ ] Wait for pipeline to complete (TRANSCRIBE → HIGHLIGHT_DETECT → CLIP_RENDER → THUMBNAIL_GEN)
  - [ ] Verify project status becomes `clips_ready` (or `clips_proposed` if auto-render not implemented)
  - [ ] Verify clips are created in database
  - [ ] Verify clips have `storage_path` and `thumb_path`

- [ ] **Publish a test clip to YouTube**
  - [ ] Call `POST /api/publish/youtube` with clip ID
  - [ ] Verify `PUBLISH_YOUTUBE` job is created
  - [ ] Wait for job to complete
  - [ ] Verify clip appears on YouTube channel
  - [ ] Verify clip `status` is `published` and `external_id` is set

- [ ] **Test viral experiment flow** (optional but recommended)
  - [ ] Create experiment via `POST /api/viral/experiments`
  - [ ] Attach clip to variant
  - [ ] Publish with experiment context
  - [ ] Verify `variant_posts` are created
  - [ ] Push metrics via `POST /api/viral/metrics`
  - [ ] Verify metrics are stored

- [ ] **Test usage limits**
  - [ ] Create workspace with plan (e.g., `starter`)
  - [ ] Upload videos until limit is reached
  - [ ] Verify `429 Too Many Requests` is returned when limit exceeded
  - [ ] Verify pipelines stop processing when limits are hit

- [ ] **Run readiness checks**
  - [ ] `curl https://staging-api.cliply.com/api/readyz` → should return 200
  - [ ] `pnpm -C apps/worker readyz` → should exit 0

### Production Launch

- [ ] **Repeat all pre-launch steps for production**
  - [ ] Create production Supabase project
  - [ ] Run migrations
  - [ ] Create buckets
  - [ ] Configure webhook (production URL)
  - [ ] Set production env vars
  - [ ] Deploy API and worker

- [ ] **Set up production OAuth apps**
  - [ ] Create production Google OAuth client
  - [ ] Add production redirect URLs
  - [ ] Create production TikTok app (if using TikTok)
  - [ ] Update env vars with production OAuth credentials

- [ ] **Set up monitoring** (recommended)
  - [ ] Configure Sentry DSN (if using)
  - [ ] Set up uptime monitoring for `/api/healthz`
  - [ ] Set up alerting for `/api/readyz` failures
  - [ ] Set up worker health monitoring

- [ ] **Run production smoke tests**
  - [ ] Test OAuth flow
  - [ ] Test upload → publish flow
  - [ ] Verify readiness endpoints

- [ ] **Onboard first real client**
  - [ ] Create workspace for client
  - [ ] Assign plan (manually or via admin)
  - [ ] Guide client through OAuth connection
  - [ ] Test upload and publish flow with real content

### Optional but Highly Recommended

- [ ] **Set up database backups** (Supabase handles this, but verify retention policy)
- [ ] **Set up log aggregation** (e.g., Datadog, Logtail, or Supabase Logs)
- [ ] **Configure rate limiting** (if not already done at infrastructure level)
- [ ] **Set up error alerting** (Sentry, PagerDuty, etc.)
- [ ] **Document runbooks** for common issues (job failures, OAuth errors, etc.)

---

## 7. TikTok Posting V1

### 7.1 Overview

TikTok posting is **fully implemented** in V1. The system supports:
- ✅ TikTok OAuth connection flow
- ✅ Real TikTok API client for video publishing
- ✅ Multi-account publishing (publish to multiple TikTok accounts)
- ✅ Viral experiment integration (variant_posts tracking)
- ✅ Token refresh and management
- ✅ Idempotent publishing (prevents duplicate posts)

### 7.2 Required Environment Variables

Ensure the following environment variables are set in your deployment:

```bash
# TikTok OAuth (required for TikTok publishing)
TIKTOK_CLIENT_ID=your-client-key-from-tiktok-developer-portal
TIKTOK_CLIENT_SECRET=your-client-secret-from-tiktok-developer-portal
TIKTOK_OAUTH_REDIRECT_URL=https://api.cliply.com/api/auth/tiktok/connect/callback
```

**Where to get these values:**
- Go to [TikTok Developer Portal](https://developers.tiktok.com/)
- Navigate to your app → **Basic Information**
- Copy **Client Key** → set as `TIKTOK_CLIENT_ID`
- Copy **Client Secret** → set as `TIKTOK_CLIENT_SECRET`
- Set redirect URL to match your domain (see Section 4.2 for details)

### 7.3 TikTok Developer Console Configuration

#### Required Scopes / Permissions

In your TikTok Developer Portal app, ensure the following scopes are requested:

- ✅ **`user.info.basic`** - Get user information (required for OAuth)
- ✅ **`video.upload`** - Upload videos to TikTok (required for publishing)

**How to configure:**
1. Go to TikTok Developer Portal → Your App → **Permissions**
2. Ensure both scopes are listed and approved
3. If testing, add test users in **Test Users** section

#### Redirect URL Configuration

Add the following redirect URLs in TikTok Developer Portal → **Basic Information** → **Redirect URLs**:

- **Staging**: `https://staging-api.cliply.com/api/auth/tiktok/connect/callback`
- **Production**: `https://api.cliply.com/api/auth/tiktok/connect/callback`
- **Local Dev** (optional): `http://localhost:3000/api/auth/tiktok/connect/callback`

**Important**: The redirect URL must match **exactly** (including protocol, domain, and path).

### 7.4 Connecting a TikTok Account

#### Via Frontend (Recommended)

1. User navigates to integrations/settings page
2. Clicks "Connect TikTok Account"
3. Redirected to TikTok OAuth consent screen
4. User authorizes the app
5. Redirected back to callback URL
6. Tokens are stored in `connected_accounts` table

#### Via API (For Testing)

1. Call `GET /api/auth/tiktok/connect?workspace_id=<uuid>`
2. User is redirected to TikTok OAuth
3. After authorization, callback stores tokens

**Verify connection:**
```sql
SELECT id, platform, status, external_id, display_name 
FROM connected_accounts 
WHERE platform = 'tiktok' AND workspace_id = '<workspace-id>';
```

### 7.5 Smoke Test

Use the smoke test script to verify TikTok publishing works:

```bash
# Via command line arguments
pnpm -C apps/worker smoke:tiktok \
  --workspace-id=<workspace-uuid> \
  --clip-id=<ready-clip-uuid> \
  --account-id=<tiktok-account-uuid> \
  --caption="Test caption (optional)"

# Or via environment variables
export WORKSPACE_ID=<workspace-uuid>
export CLIP_ID=<ready-clip-uuid>
export CONNECTED_ACCOUNT_ID=<tiktok-account-uuid>
export CAPTION="Test caption (optional)"
pnpm -C apps/worker smoke:tiktok
```

**What the smoke test does:**
1. Validates clip exists and is ready (`status='ready'`, has `storage_path`)
2. Validates TikTok account exists and is active
3. Creates a `PUBLISH_TIKTOK` job in the queue
4. Prints job ID and details

**Note**: The smoke test only **enqueues** the job. The worker must be running separately to process it.

**Expected output:**
```
🔍 Validating clip and account...
✅ Clip validated: <clip-id>
   Status: ready
   Storage path: renders/<workspace-id>/<project-id>/<clip-id>.mp4
✅ Account validated: <account-id>
   Platform: tiktok
   Status: active

📝 Creating PUBLISH_TIKTOK job...
✅ Job created successfully!

📊 Job Details:
   Job ID: <job-id>
   Kind: PUBLISH_TIKTOK
   Status: queued
   Created at: <timestamp>
   Workspace ID: <workspace-id>
   Clip ID: <clip-id>
   Account ID: <account-id>
   Caption: <caption>

💡 Next steps:
   1. Ensure the worker is running: pnpm -C apps/worker dev
   2. Monitor logs for PUBLISH_TIKTOK pipeline execution
   3. Check variant_posts table for posted status
   4. Query job status: SELECT * FROM jobs WHERE id = '<job-id>'
```

### 7.6 Verifying Success

#### Check Job Status

```sql
SELECT id, kind, status, state, attempts, error, result, created_at, updated_at
FROM jobs
WHERE id = '<job-id>';
```

**Expected status progression:**
- `status='queued'` → Job created
- `status='claimed'` → Worker picked up job
- `status='done'` → Job completed successfully
- `status='failed'` → Job failed (check `error` field)

#### Check Logs

Look for these log events in worker logs:

**Success:**
```
publish_tiktok_start: { jobId, clipId, workspaceId, connectedAccountId }
publish_tiktok_completed: { jobId, videoId, durationMs }
```

**Failure:**
```
publish_tiktok_failed: { jobId, error, tiktokStatus, tiktokErrorCode }
```

**Idempotent skip:**
```
publish_tiktok_already_posted: { clipId, connectedAccountId, platformPostId }
```

#### Check Database Records

**Clip updated:**
```sql
SELECT id, status, external_id, published_at
FROM clips
WHERE id = '<clip-id>';
-- Should show: status='published', external_id='<tiktok-video-id>'
```

**Variant posts updated (if part of experiment):**
```sql
SELECT id, clip_id, connected_account_id, platform, status, platform_post_id, posted_at
FROM variant_posts
WHERE clip_id = '<clip-id>' AND platform = 'tiktok';
-- Should show: status='posted', platform_post_id='<tiktok-video-id>'
```

#### Verify on TikTok

1. Log into the connected TikTok account
2. Check "My Videos" or profile page
3. Verify the video appears with the correct caption

### 7.7 TikTok-Specific Constraints

#### Video Format Requirements

- **File format**: MP4 (H.264 codec recommended)
- **Max duration**: 10 minutes (TikTok limit)
- **Max file size**: 287MB (TikTok limit)
- **Aspect ratio**: 9:16 (vertical) recommended, but other ratios supported
- **Resolution**: Minimum 720p, maximum 4K

#### Caption Constraints

- **Max length**: 2,200 characters (TikTok limit)
- **Hashtags**: Supported (e.g., `#hashtag`)
- **Mentions**: Supported (e.g., `@username`)
- **Truncation**: If caption exceeds limit, it will be truncated automatically

#### Privacy Levels

Supported privacy levels (from `PUBLISH_TIKTOK` payload):
- `PUBLIC_TO_EVERYONE` - Public video (default)
- `MUTUAL_FOLLOW_FRIEND` - Only visible to mutual followers
- `SELF_ONLY` - Private (only visible to account owner)

#### Rate Limits

TikTok API rate limits:
- **Upload rate**: Varies by account tier (typically 10-20 videos per day for new accounts)
- **API rate limit**: 429 status code if exceeded
- **Retry behavior**: Pipeline automatically retries on 429 errors (with backoff)

### 7.8 Troubleshooting

#### Common Issues

**"TikTok authentication failed (401)"**
- Token expired or invalid
- Solution: Reconnect TikTok account via OAuth flow
- Check: `connected_accounts.expires_at` and token refresh logic

**"TikTok API rate limited (429)"**
- Too many requests in short time
- Solution: Wait and retry (pipeline handles this automatically)
- Check: Worker logs for retry attempts

**"Clip not ready for publish"**
- Clip status is not `'ready'` or missing `storage_path`
- Solution: Ensure clip has been rendered (`CLIP_RENDER` job completed)
- Check: `clips.status` and `clips.storage_path`

**"TikTok connected account is not active"**
- Account status is not `'active'` or `null`
- Solution: Check `connected_accounts.status` and update if needed
- Check: Account may have been disconnected or revoked

**"TikTok API server error (500)"**
- TikTok API is experiencing issues
- Solution: Retry later (pipeline handles this automatically)
- Check: [TikTok Developer Status](https://developers.tiktok.com/) for known issues

### 7.9 Multi-Account Publishing

To publish to multiple TikTok accounts:

```bash
POST /api/publish/tiktok
{
  "clipId": "<clip-id>",
  "connectedAccountIds": ["<account-1-id>", "<account-2-id>"],
  "caption": "Shared caption",
  "privacyLevel": "PUBLIC_TO_EVERYONE"
}
```

**What happens:**
1. API creates one `PUBLISH_TIKTOK` job per account
2. Each job is processed independently
3. Each account gets its own `variant_post` record (if part of experiment)
4. Response includes `jobIds` array and `accountCount`

### 7.10 Integration with Viral Experiments

When publishing as part of a viral experiment:

```bash
POST /api/publish/tiktok
{
  "clipId": "<clip-id>",
  "connectedAccountIds": ["<account-id>"],
  "experimentId": "<experiment-id>",
  "variantId": "<variant-id>",
  "caption": "Variant caption"
}
```

**What happens:**
1. Clip is attached to experiment variant
2. `variant_posts` records are created for each account
3. After successful publish, `variant_posts` are updated with `platform_post_id`
4. Metrics can be pushed later via `POST /api/viral/metrics`

---

## 8. Future (Non-Blocking) Backend Work

The following items are **explicitly out-of-scope for initial V1 launch** but should be prioritized for V1.5+:

### 8.1 TikTok Publishing

- **Status**: ✅ **COMPLETE** - Fully implemented in V1
- **What was done**:
  - ✅ TikTok API client implemented (`apps/worker/src/services/tiktok/client.ts`)
  - ✅ `PUBLISH_TIKTOK` pipeline completed (`apps/worker/src/pipelines/publish-tiktok.ts`)
  - ✅ `/api/publish/tiktok` endpoint exists and works
  - ✅ Integrated with viral experiments (variant_posts creation/update)
  - ✅ Smoke test script added (`apps/worker/scripts/smoke.tiktok.publish.ts`)
  - ✅ Comprehensive tests added

### 8.2 Pipeline Orchestration Improvements

- **Status**: Clips are created with `status='proposed'` but not automatically rendered
- **What's needed**:
  - Auto-enqueue `CLIP_RENDER` jobs after `HIGHLIGHT_DETECT` completes
  - Set `project.status='clips_ready'` when all clips are rendered
  - Or add manual trigger API for clip rendering
- **Priority**: Medium (manual trigger may be acceptable for V1)

### 8.3 Multi-Account Publishing Loop

- **Status**: `PUBLISH_YOUTUBE` pipeline only handles first account in array
- **What's needed**:
  - Loop through all `connectedAccountIds[]` in pipeline
  - Create separate jobs or handle in single job
- **Priority**: Medium (can work around by creating separate publish requests)

### 8.4 Metrics Ingestion

- **Status**: Metrics must be pushed via API (`POST /api/viral/metrics`)
- **What's needed**:
  - Automated YouTube Analytics fetcher (cron job or scheduled worker)
  - Automated TikTok Analytics fetcher
  - Scheduled job to fetch metrics for all active `variant_posts`
- **Priority**: Low (manual push may be acceptable for V1)

### 8.5 Advanced Viral Automation

- **Status**: Foundation exists (experiments, variants, metrics) but no automation
- **What's needed**:
  - Auto-delete/repost logic for underperforming variants
  - Automated winner selection based on goal_metric
  - A/B test completion and reporting
- **Priority**: Low (manual analysis may be acceptable for V1)

### 8.6 Test Harness Cleanup

- **Status**: Some tests use `x-debug-user` headers and require manual env setup
- **What's needed**:
  - Mock Supabase client for tests
  - Mock OAuth providers
  - Remove hardcoded test user IDs
  - Ensure all tests pass in CI without manual setup
- **Priority**: Low (tests work, just need cleanup)

### 8.7 Token Encryption Verification

- **Status**: Tokens stored as `*_encrypted_ref` but encryption implementation not verified
- **What's needed**:
  - Verify `sealedBoxEncryptRef`/`sealedBoxDecryptRef` are actually implemented
  - Verify encryption keys are stored securely (not in code)
  - Add encryption key rotation support
- **Priority**: Medium (security-critical, but may work for V1 if encryption is placeholder)

---

## Appendix: Quick Reference

### Key Endpoints

- `GET /api/healthz` - Health check
- `GET /api/readyz` - Readiness check
- `POST /api/upload/init` - Initialize upload (file or YouTube)
- `GET /api/oauth/google/start` - Start YouTube OAuth
- `GET /api/oauth/google/callback` - YouTube OAuth callback
- `POST /api/publish/youtube` - Publish clip to YouTube
- `POST /api/publish/tiktok` - Publish clip to TikTok
- `POST /api/viral/experiments` - Create experiment
- `POST /api/viral/metrics` - Push metrics

### Key Commands

- `pnpm -C apps/worker readyz` - Worker readiness check
- `pnpm -C apps/worker smoke:tiktok` - TikTok publish smoke test
- `pnpm typecheck` - TypeScript type checking
- `pnpm test` - Run tests

### Storage Buckets

- `videos` - Source videos
- `transcripts` - Transcription files
- `renders` - Rendered clips
- `thumbs` - Thumbnails

### Database Tables (Core)

- `workspaces` - Workspace data
- `workspace_members` - User-workspace relationships
- `jobs` - Job queue
- `projects` - Source video projects
- `clips` - Generated clips
- `connected_accounts` - OAuth-connected accounts
- `publish_config` - Publishing defaults
- `experiments` - Viral experiments
- `experiment_variants` - Experiment variants
- `variant_posts` - Posts linked to variants
- `variant_metrics` - Metrics for variant posts
- `workspace_usage` - Usage tracking

---

**End of Launch Checklist**

