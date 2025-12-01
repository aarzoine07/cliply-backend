# Cliply Backend – Production Deployment Checklist

**Last Updated:** 2025-01-XX  
**Purpose:** Complete deployment checklist for bringing Cliply backend to production  
**Scope:** Vercel (web + API), Supabase (DB + auth), Stripe (billing), Worker (jobs), Cron (scheduling)

This checklist ensures all components are properly configured before launching to production. Use this document when deploying for the first time or re-creating the production environment.

---

## Overview

The Cliply backend consists of:

- **Vercel** – Next.js web app and API routes (`apps/web`)
- **Supabase** – PostgreSQL database, authentication, and RLS policies
- **Stripe** – Billing, subscriptions, and webhook handling
- **Worker** – Background job processing (transcribe, render, publish)
- **Cron** – Scheduled publishing via Vercel Cron
- **Sentry** – Error monitoring and observability

All environment variables are defined in `packages/shared/src/env.ts` (single source of truth). See `ENV.md` for detailed variable descriptions.

---

## 1. Environments & URLs

- [ ] **Production Domain**
  - Marketing site: `https://cliply.ai` (or your domain)
  - App URL: `https://app.cliply.ai` (or your domain)
  - Update `NEXT_PUBLIC_APP_URL` with production URL

- [ ] **Supabase Project**
  - Project URL: `https://<project-id>.supabase.co`
  - Dashboard: `https://supabase.com/dashboard/project/<project-id>`
  - Region: `<select-region>` (e.g., `us-east-1`)

- [ ] **Stripe Account**
  - Dashboard: `https://dashboard.stripe.com`
  - Account mode: `Live` (switch from test mode)
  - Account ID: `<stripe-account-id>`

- [ ] **Vercel Project**
  - Project name: `<cliply-backend>` (or your project name)
  - Production URL: `https://<project-name>.vercel.app`
  - Preview URL pattern: `https://<project-name>-<hash>.vercel.app`
  - GitHub repo: `<org>/<repo-name>`

- [ ] **Sentry Project**
  - Dashboard: `https://cliply.sentry.io`
  - Project: `cliply / javascript-nextjs`
  - DSN: `<sentry-dsn>` (see Sentry dashboard)

---

## 2. Environment Variables

Set all required environment variables in **Vercel Dashboard → Settings → Environment Variables** for both **Production** and **Preview** environments.

### 2.1 Core App (Supabase)

- [ ] `SUPABASE_URL`
  - **Description:** Supabase project URL
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Example:** `https://xxx.supabase.co`
  - **Source:** Supabase Dashboard → Settings → API

- [ ] `SUPABASE_ANON_KEY`
  - **Description:** Supabase anonymous key (client-side)
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Example:** `eyJhbGc...`
  - **Source:** Supabase Dashboard → Settings → API

- [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - **Description:** Supabase service role key (server-side only, never expose to browser)
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Example:** `eyJhbGc...`
  - **Source:** Supabase Dashboard → Settings → API
  - **⚠️ Security:** Never commit or expose this key

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
  - **Description:** Supabase URL for client-side (must match `SUPABASE_URL`)
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://xxx.supabase.co`
  - **Note:** Same value as `SUPABASE_URL`, but required for Next.js client-side

- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - **Description:** Supabase anon key for client-side (must match `SUPABASE_ANON_KEY`)
  - **Where:** Vercel (Production + Preview)
  - **Example:** `eyJhbGc...`
  - **Note:** Same value as `SUPABASE_ANON_KEY`, but required for Next.js client-side

- [ ] `NODE_ENV`
  - **Description:** Node environment
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Value:** `production` (for production), `development` (for preview)
  - **Default:** `development` (if not set)

### 2.2 Stripe (Billing)

- [ ] `STRIPE_SECRET_KEY`
  - **Description:** Stripe secret API key (live mode)
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Example:** `sk_live_...` (production) or `sk_test_...` (testing)
  - **Source:** Stripe Dashboard → Developers → API keys
  - **⚠️ Security:** Never commit or expose this key

- [ ] `STRIPE_WEBHOOK_SECRET`
  - **Description:** Stripe webhook signing secret for production endpoint
  - **Where:** Vercel (Production only)
  - **Example:** `whsec_...`
  - **Source:** Stripe Dashboard → Developers → Webhooks → Endpoint → Signing secret
  - **Note:** Create webhook endpoint first (see Stripe Setup section)

- [ ] **Stripe Product/Price IDs** (verify these match `packages/shared/billing/stripePlanMap.ts`)
  - [ ] Basic plan price ID: `price_1SPAJQJ2vBRZZMLQFeAuYJK5`
  - [ ] Pro plan price ID: `price_1SPALSJ2vBRZZMLQjM9eLBkf`
  - [ ] Premium plan price ID: `price_1SPAM7J2vBRZZMLQQaPkyiEW`
  - **Note:** These are hardcoded in the codebase. Verify they exist in your Stripe account.

### 2.3 OAuth / Publishing

#### YouTube/Google OAuth

- [ ] `GOOGLE_CLIENT_ID`
  - **Description:** Google OAuth client ID
  - **Where:** Vercel (Production + Preview)
  - **Example:** `xxx.apps.googleusercontent.com`
  - **Source:** Google Cloud Console → APIs & Services → Credentials

- [ ] `GOOGLE_CLIENT_SECRET`
  - **Description:** Google OAuth client secret
  - **Where:** Vercel (Production + Preview)
  - **Example:** `GOCSPX-xxx`
  - **Source:** Google Cloud Console → APIs & Services → Credentials
  - **⚠️ Security:** Never commit or expose this key

- [ ] `YOUTUBE_OAUTH_REDIRECT_URL`
  - **Description:** YouTube OAuth redirect URL (server-side)
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://app.cliply.ai/api/auth/youtube/callback`
  - **Note:** Must match redirect URI configured in Google Cloud Console

#### TikTok OAuth

- [ ] `TIKTOK_CLIENT_ID`
  - **Description:** TikTok OAuth client key
  - **Where:** Vercel (Production + Preview)
  - **Example:** `<tiktok-client-id>`
  - **Source:** TikTok Developer Portal

- [ ] `TIKTOK_CLIENT_SECRET`
  - **Description:** TikTok OAuth client secret
  - **Where:** Vercel (Production + Preview)
  - **Example:** `<tiktok-client-secret>`
  - **Source:** TikTok Developer Portal
  - **⚠️ Security:** Never commit or expose this key

- [ ] `TIKTOK_OAUTH_REDIRECT_URL`
  - **Description:** TikTok OAuth redirect URL (server-side)
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://app.cliply.ai/api/auth/tiktok/callback`
  - **Note:** Must match redirect URI configured in TikTok Developer Portal

- [ ] `TIKTOK_ENCRYPTION_KEY`
  - **Description:** Base64-encoded 32-byte key for encrypting TikTok tokens at rest
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Generate:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - **⚠️ Security:** Keep this secret and rotate periodically

- [ ] `NEXT_PUBLIC_TIKTOK_REDIRECT_URL`
  - **Description:** TikTok OAuth redirect URL (client-side)
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://app.cliply.ai/api/auth/tiktok/connect/callback`
  - **Note:** Different from server-side redirect URL

- [ ] `TIKTOK_TOKEN_URL` (optional)
  - **Description:** TikTok token endpoint URL
  - **Where:** Vercel (Production + Preview)
  - **Default:** `https://open.tiktokapis.com/v2/oauth/token/`

### 2.4 Observability

- [ ] `SENTRY_DSN`
  - **Description:** Sentry error monitoring DSN
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Example:** `https://xxx@sentry.io/xxx`
  - **Source:** Sentry Dashboard → Settings → Client Keys (DSN)
  - **Note:** Optional but highly recommended

- [ ] `NEXT_PUBLIC_SENTRY_DSN`
  - **Description:** Sentry DSN for client-side error tracking
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://xxx@sentry.io/xxx`
  - **Note:** Same value as `SENTRY_DSN`, but required for Next.js client-side

- [ ] `LOG_SAMPLE_RATE`
  - **Description:** Log sampling rate (0.0-1.0)
  - **Where:** Vercel (Production + Preview), Worker environment
  - **Default:** `1` (100% sampling)
  - **Example:** `0.1` (10% sampling for high-traffic)

- [ ] `NEXT_PUBLIC_APP_URL`
  - **Description:** Application public URL
  - **Where:** Vercel (Production + Preview)
  - **Example:** `https://app.cliply.ai`
  - **Note:** Used for OAuth redirects and client-side links

### 2.5 Worker Configuration (Optional)

- [ ] `WORKER_POLL_MS`
  - **Description:** Worker poll interval (milliseconds)
  - **Where:** Worker environment only
  - **Default:** Not set (uses code defaults)
  - **Example:** `1000` (1 second)

- [ ] `WORKER_HEARTBEAT_MS`
  - **Description:** Worker heartbeat interval (milliseconds)
  - **Where:** Worker environment only
  - **Default:** Not set (uses code defaults)
  - **Example:** `5000` (5 seconds)

- [ ] `WORKER_RECLAIM_MS`
  - **Description:** Worker job reclaim interval (milliseconds)
  - **Where:** Worker environment only
  - **Default:** Not set (uses code defaults)
  - **Example:** `60000` (60 seconds)

- [ ] `WORKER_STALE_SECONDS`
  - **Description:** Seconds before a job is considered stale
  - **Where:** Worker environment only
  - **Default:** Not set (uses code defaults)
  - **Example:** `120` (2 minutes)

### 2.6 Cron & Automation

- [ ] `CRON_SECRET`
  - **Description:** Secret for authenticating cron job requests
  - **Where:** Vercel (Production only)
  - **Generate:** Use a strong random string (e.g., `openssl rand -base64 32`)
  - **Note:** Vercel Cron automatically sends this in `Authorization: Bearer <CRON_SECRET>` header
  - **⚠️ Security:** Keep this secret

- [ ] `VERCEL_AUTOMATION_BYPASS_SECRET` (optional, for testing)
  - **Description:** Secret for bypassing Vercel protection in testing
  - **Where:** Vercel (Preview only, for testing)
  - **Note:** Only needed if manually testing cron endpoints

### 2.7 External Services (Optional)

- [ ] `DEEPGRAM_API_KEY`
  - **Description:** Deepgram API key for transcription
  - **Where:** Worker environment only
  - **Source:** Deepgram Dashboard
  - **Note:** Required if using Deepgram for transcription

- [ ] `OPENAI_API_KEY`
  - **Description:** OpenAI API key
  - **Where:** Worker environment only
  - **Source:** OpenAI Dashboard
  - **Note:** Required if using OpenAI for transcription or other AI features

- [ ] `DATABASE_URL` (optional)
  - **Description:** Direct database connection URL (bypasses Supabase client)
  - **Where:** Worker environment only (if needed)
  - **Example:** `postgresql://postgres:password@host:5432/postgres`
  - **Note:** Usually not needed; Supabase client is preferred

---

## 3. Supabase Setup

- [ ] **Project Selection**
  - [ ] Confirm correct Supabase project is selected
  - [ ] Verify project region matches your user base
  - [ ] Note project URL and API keys (see Environment Variables section)

- [ ] **Database Migrations**
  - [ ] Apply all migrations from `supabase/migrations/` directory
  - [ ] **Command:** `supabase db push` (if using Supabase CLI) or apply via Supabase Dashboard → SQL Editor
  - [ ] **Verify:** Check that all tables exist:
    - `workspaces`, `workspace_members`, `users`
    - `projects`, `clips`, `jobs`, `job_events`
    - `connected_accounts`, `schedules`, `subscriptions`
    - `workspace_usage`, `rate_limits`, `idempotency`
  - [ ] **Verify RPCs exist:**
    - `worker_claim_next_job`
    - `worker_heartbeat`
    - `worker_finish`
    - `worker_reclaim_stale`
    - `increment_workspace_usage`

- [ ] **Row Level Security (RLS)**
  - [ ] Confirm RLS is enabled on all tables (see `db/rls.sql` or migration files)
  - [ ] Verify RLS policies are applied:
    - Workspaces: members can read, owners can modify
    - Jobs: workspace-scoped access
    - Connected accounts: user-scoped access
    - Subscriptions: workspace-scoped access
  - [ ] **Test:** Verify service role key can bypass RLS (for worker/admin operations)

- [ ] **Backup Configuration**
  - [ ] Enable automated backups in Supabase Dashboard → Settings → Database
  - [ ] Set backup retention period (recommended: 7-30 days)
  - [ ] Document backup recovery procedure (see backup/recovery milestone)

- [ ] **Stripe Webhook URL** (if Supabase needs to call Stripe)
  - [ ] Configure webhook URL in Supabase (if applicable)
  - [ ] **Note:** Usually not needed; Stripe webhooks call Vercel directly

---

## 4. Stripe Setup

- [ ] **Account Mode**
  - [ ] Switch Stripe account from **Test Mode** to **Live Mode**
  - [ ] Verify account is activated and can accept payments
  - [ ] Note: Test mode keys (`sk_test_...`) will not work in production

- [ ] **Products & Prices**
  - [ ] Create or verify products exist in Stripe Dashboard → Products:
    - [ ] **Basic Plan** – Price ID: `price_1SPAJQJ2vBRZZMLQFeAuYJK5`
      - Features: 5 uploads/day, 3 clips/project, no scheduling
    - [ ] **Pro Plan** – Price ID: `price_1SPALSJ2vBRZZMLQjM9eLBkf`
      - Features: 30 uploads/day, 12 clips/project, scheduling enabled
    - [ ] **Premium Plan** – Price ID: `price_1SPAM7J2vBRZZMLQQaPkyiEW`
      - Features: 150 uploads/day, 40 clips/project, scheduling enabled
  - [ ] **Verify:** Price IDs match `packages/shared/billing/stripePlanMap.ts`
  - [ ] **Note:** If price IDs differ, update `stripePlanMap.ts` before deploying

- [ ] **Webhook Endpoint**
  - [ ] Create webhook endpoint in Stripe Dashboard → Developers → Webhooks
  - [ ] **Production URL:** `https://<your-vercel-domain>/api/webhooks/stripe`
  - [ ] **Staging URL (optional):** `https://<preview-domain>/api/webhooks/stripe`
  - [ ] **Events to listen for:**
    - `checkout.session.completed`
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.payment_succeeded`
    - `invoice.payment_failed`
  - [ ] **Copy webhook signing secret:** `whsec_...` → Set as `STRIPE_WEBHOOK_SECRET` in Vercel
  - [ ] **Test:** Send test webhook from Stripe Dashboard to verify endpoint responds

- [ ] **Verify Plan Resolution**
  - [ ] Test `resolveWorkspacePlan` function with production price IDs
  - [ ] Verify webhook handler (`/api/webhooks/stripe`) processes events correctly
  - [ ] **Location:** `apps/web/src/pages/api/webhooks/stripe.ts`
  - [ ] **Test:** Create test subscription and verify workspace plan updates

---

## 5. Vercel Setup (Web + API)

- [ ] **Project Creation**
  - [ ] Create Vercel project and connect to GitHub repository
  - [ ] Set project name (e.g., `cliply-backend`)
  - [ ] Configure root directory: `apps/web` (if monorepo)
  - [ ] Set framework preset: **Next.js**

- [ ] **Build Configuration**
  - [ ] **Build Command:** `pnpm run build` (or `pnpm --filter @cliply/web build`)
  - [ ] **Install Command:** `pnpm install`
  - [ ] **Output Directory:** `apps/web/.next` (auto-detected by Vercel)
  - [ ] **Node Version:** 20.x (verify in Vercel Settings → General)

- [ ] **Environment Variables**
  - [ ] Set all required environment variables (see Section 2)
  - [ ] Configure for **Production**, **Preview**, and **Development** environments
  - [ ] **Important:** `NEXT_PUBLIC_*` variables must be set for both server and client
  - [ ] Verify variables are not exposed in build logs (Vercel hides secrets by default)

- [ ] **Branch Protection**
  - [ ] Protect `main` branch (or production branch) in Vercel Settings → Git
  - [ ] Require preview deployments for pull requests
  - [ ] Enable automatic deployments from `main` branch

- [ ] **Custom Domain** (optional)
  - [ ] Add custom domain in Vercel Settings → Domains
  - [ ] Configure DNS records (CNAME or A record)
  - [ ] Update `NEXT_PUBLIC_APP_URL` with custom domain

### 5.1 Cron Setup

- [ ] **Vercel Cron Configuration**
  - [ ] Create `vercel.json` in `apps/web/` (if not exists) or update existing
  - [ ] Add cron job configuration:
    ```json
    {
      "crons": [
        {
          "path": "/api/cron/scan-schedules",
          "schedule": "* * * * *"
        }
      ]
    }
    ```
  - [ ] **Schedule:** `* * * * *` (every minute) or adjust as needed
  - [ ] **Path:** `/api/cron/scan-schedules` (matches `apps/web/src/pages/api/cron/scan-schedules.ts`)
  - [ ] **Note:** Vercel Cron requires Hobby plan or higher

- [ ] **Cron Authentication**
  - [ ] Set `CRON_SECRET` in Vercel environment variables (Production only)
  - [ ] Verify cron endpoint checks `Authorization: Bearer <CRON_SECRET>` header
  - [ ] **Test:** Manually call endpoint with `CRON_SECRET` to verify authentication

- [ ] **Verify Cron Execution**
  - [ ] Check Vercel Dashboard → Cron Jobs for execution logs
  - [ ] Verify scheduled publishes actually fire (create test schedule and wait)
  - [ ] Monitor logs for `cron_scan_schedules_success` events

---

## 6. Worker / Jobs Setup

- [ ] **Worker Deployment Method**
  - [ ] **Option A:** Deploy worker as separate service (e.g., Railway, Render, Fly.io)
  - [ ] **Option B:** Use Vercel Cron to trigger worker jobs (if applicable)
  - [ ] **Option C:** Use Supabase Edge Functions (if applicable)
  - [ ] **Current Setup:** Worker runs as standalone Node.js process (see `apps/worker/src/worker.ts`)

- [ ] **Worker Environment Variables**
  - [ ] Set all required variables in worker environment:
    - `SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `TIKTOK_ENCRYPTION_KEY`
    - `SENTRY_DSN` (optional)
    - `WORKER_POLL_MS`, `WORKER_HEARTBEAT_MS`, etc. (optional)
    - `DEEPGRAM_API_KEY` or `OPENAI_API_KEY` (if using transcription)
  - [ ] **Note:** Worker does NOT need `NEXT_PUBLIC_*` variables

- [ ] **Verify RPC Functions**
  - [ ] Test `worker_claim_next_job` RPC:
    ```sql
    SELECT * FROM worker_claim_next_job('worker-123');
    ```
  - [ ] Test `worker_heartbeat` RPC:
    ```sql
    SELECT * FROM worker_heartbeat('worker-123', 'job-456');
    ```
  - [ ] Test `worker_reclaim_stale` RPC:
    ```sql
    SELECT * FROM worker_reclaim_stale(120);
    ```
  - [ ] **Location:** See `supabase/migrations/` for RPC definitions

- [ ] **Job Processing Verification**
  - [ ] Enqueue a test job via `/api/jobs/enqueue`
  - [ ] Verify worker claims the job
  - [ ] Verify job completes successfully
  - [ ] Check job status in `jobs` table

- [ ] **Admin Job Endpoints** (for manual operations)
  - [ ] **Retry Job:** `POST /api/admin/jobs/[id]/retry`
    - Requires: `Authorization: Bearer <SERVICE_ROLE_KEY>`
    - Use case: Retry failed jobs
  - [ ] **Cancel Job:** `POST /api/admin/jobs/[id]/cancel`
    - Requires: `Authorization: Bearer <SERVICE_ROLE_KEY>`
    - Use case: Cancel queued or running jobs
  - [ ] **Unlock Job:** `POST /api/admin/jobs/[id]/unlock`
    - Requires: `Authorization: Bearer <SERVICE_ROLE_KEY>`
    - Use case: Unlock stuck jobs (stale heartbeat)
  - [ ] **Test:** Verify all three endpoints work with service role key

---

## 7. Cron & Scheduling

- [ ] **Vercel Cron Configuration** (see Section 5.1)
  - [ ] Cron job configured in `vercel.json`
  - [ ] Endpoint: `/api/cron/scan-schedules`
  - [ ] Schedule: Every minute (`* * * * *`) or adjust as needed
  - [ ] `CRON_SECRET` set in Vercel environment variables

- [ ] **Schedule Scanning Verification**
  - [ ] Create a test schedule in a workspace
  - [ ] Set `run_at` to a time in the near future (e.g., 2 minutes from now)
  - [ ] Wait for cron to execute
  - [ ] Verify schedule is processed and job is enqueued
  - [ ] Check logs for `cron_scan_schedules_success` events

- [ ] **Scheduled Publishing Test**
  - [ ] Create a test workspace with a connected account (TikTok or YouTube)
  - [ ] Create a schedule for a clip
  - [ ] Set schedule time to 5 minutes in the future
  - [ ] Wait for cron to execute
  - [ ] Verify publish job is enqueued and processed
  - [ ] Verify clip is published to the platform

---

## 8. Observability & Monitoring

- [ ] **Sentry Setup**
  - [ ] `SENTRY_DSN` set in Vercel (Production + Preview)
  - [ ] `NEXT_PUBLIC_SENTRY_DSN` set in Vercel (for client-side)
  - [ ] Verify Sentry initializes on app startup (check logs)
  - [ ] **Web App:** Verify `apps/web/sentry.server.config.ts` and `sentry.edge.config.ts` are configured
  - [ ] **Worker:** Verify `packages/shared/src/sentry.ts` initializes in worker
  - [ ] **Test:** Trigger a test error and verify it appears in Sentry dashboard

- [ ] **Sentry Alerts**
  - [ ] Configure error rate alerts (e.g., > 10 errors/minute)
  - [ ] Configure performance alerts (e.g., P95 latency > 2s)
  - [ ] Set up email/Slack notifications for critical errors

- [ ] **Logging Configuration**
  - [ ] Verify JSON logging format (structured logs)
  - [ ] Confirm sensitive data is redacted (see `apps/web/src/lib/logger.ts`)
  - [ ] Set `LOG_SAMPLE_RATE` if needed (default: 1.0 = 100% sampling)

- [ ] **Supabase Monitoring**
  - [ ] Link Supabase project to monitoring dashboard
  - [ ] Set up database performance alerts
  - [ ] Monitor RLS policy performance
  - [ ] Track connection pool usage

- [ ] **Vercel Analytics** (optional)
  - [ ] Enable Vercel Analytics in project settings
  - [ ] Monitor API route performance
  - [ ] Track error rates by endpoint

---

## 9. Pre-Launch Verification

### 9.1 Code & Tests

- [ ] **Test Suite**
  - [ ] Run `pnpm test` locally and verify all tests pass
  - [ ] Verify CI/CD pipeline runs tests (if configured)
  - [ ] **Expected:** 272+ tests passing, 0 failures

- [ ] **Type Checking**
  - [ ] Run `pnpm typecheck` and verify no TypeScript errors
  - [ ] Fix any type errors before deploying

- [ ] **Linting**
  - [ ] Run `pnpm lint` and fix any linting errors
  - [ ] Verify code formatting is consistent

### 9.2 OAuth Flows

- [ ] **YouTube OAuth** (end-to-end test in staging)
  - [ ] Navigate to connect YouTube account
  - [ ] Complete OAuth flow
  - [ ] Verify token is stored in `connected_accounts` table
  - [ ] Test token refresh (if applicable)

- [ ] **TikTok OAuth** (end-to-end test in staging)
  - [ ] Navigate to connect TikTok account
  - [ ] Complete OAuth flow
  - [ ] Verify encrypted token is stored in `connected_accounts` table
  - [ ] Test token refresh (if applicable)

### 9.3 Publishing

- [ ] **TikTok Publishing** (end-to-end test in staging)
  - [ ] Create a test clip
  - [ ] Publish to TikTok via `/api/publish/tiktok`
  - [ ] Verify clip appears on TikTok
  - [ ] Verify job completes successfully

- [ ] **YouTube Publishing** (end-to-end test in staging)
  - [ ] Create a test clip
  - [ ] Publish to YouTube via `/api/publish/youtube`
  - [ ] Verify clip appears on YouTube
  - [ ] Verify job completes successfully

### 9.4 Billing & Plans

- [ ] **Plan Gating** (test in staging)
  - [ ] Create test workspace with `basic` plan
  - [ ] Verify upload limits are enforced (5 uploads/day)
  - [ ] Verify scheduling is disabled for basic plan
  - [ ] Upgrade to `pro` plan and verify scheduling is enabled

- [ ] **Usage Limits** (test in staging)
  - [ ] Create test workspace
  - [ ] Upload projects up to daily limit
  - [ ] Verify limit is enforced (returns 429 or error)
  - [ ] Verify usage is tracked in `workspace_usage` table

- [ ] **Stripe Checkout** (test in staging)
  - [ ] Create checkout session via `/api/billing/checkout`
  - [ ] Complete Stripe checkout flow
  - [ ] Verify webhook processes subscription
  - [ ] Verify workspace plan updates correctly

### 9.5 Admin Operations

- [ ] **Admin Job Endpoints** (test with service role key)
  - [ ] Create a failed job
  - [ ] Retry via `POST /api/admin/jobs/[id]/retry`
  - [ ] Verify job status changes to `queued`
  - [ ] Cancel a queued job via `POST /api/admin/jobs/[id]/cancel`
  - [ ] Unlock a stuck job via `POST /api/admin/jobs/[id]/unlock`

- [ ] **Workspace Member Management** (test in staging)
  - [ ] List members via `GET /api/workspaces/[id]/members`
  - [ ] Add member via `POST /api/workspaces/[id]/members`
  - [ ] Update role via `PATCH /api/workspaces/[id]/members/[memberId]`
  - [ ] Remove member via `DELETE /api/workspaces/[id]/members/[memberId]`

### 9.6 Health Checks

- [ ] **Health Endpoints**
  - [ ] `GET /api/health` or `/api/readyz` returns 200
  - [ ] `GET /api/health/audit` returns detailed health status
  - [ ] Verify all dependencies are healthy (Supabase, Stripe, etc.)

- [ ] **Production URLs**
  - [ ] Verify production domain resolves correctly
  - [ ] Verify SSL certificate is valid
  - [ ] Test API routes respond correctly

---

## 10. Post-Launch Checklist

- [ ] **Monitor First 24 Hours**
  - [ ] Check Sentry for errors
  - [ ] Monitor Vercel logs for API route errors
  - [ ] Verify cron jobs are executing
  - [ ] Check worker is processing jobs
  - [ ] Monitor Stripe webhook deliveries

- [ ] **User Onboarding Test**
  - [ ] Create a new user account
  - [ ] Complete onboarding flow
  - [ ] Connect TikTok/YouTube account
  - [ ] Create first project and clip
  - [ ] Publish first clip

- [ ] **Documentation**
  - [ ] Update README with production URLs
  - [ ] Document any production-specific configurations
  - [ ] Create runbook for common issues

---

## Notes & Assumptions

### Deployment Assumptions

- **Worker Deployment:** Assumes worker runs as a separate service (not Vercel). If using Vercel for worker, adjust environment variable setup accordingly.
- **Cron Jobs:** Assumes Vercel Cron is used (requires Hobby plan or higher). Alternative: use external cron service (e.g., cron-job.org) to call endpoint.
- **Database Migrations:** Assumes migrations are applied via Supabase CLI or Dashboard. If using CI/CD, add migration step to deployment pipeline.

### Security Notes

- Never commit secrets to git (all `.env` files are git-ignored)
- Rotate `TIKTOK_ENCRYPTION_KEY` periodically
- Rotate `CRON_SECRET` if compromised
- Use different Stripe keys for staging and production
- Monitor Sentry for exposed secrets in error logs

### Troubleshooting

- **Build fails:** Check environment variables are set in Vercel
- **API routes return 500:** Check Vercel function logs and Sentry
- **Jobs not processing:** Verify worker is running and can connect to Supabase
- **Cron not executing:** Verify `vercel.json` cron config and `CRON_SECRET` is set
- **Webhooks failing:** Check Stripe webhook URL matches production domain

---

## References

- **Environment Variables:** See `ENV.md` for detailed variable descriptions
- **Readiness Audit:** See `REPORTS/full_readiness_audit_2025.md` for system overview
- **Codebase:** All environment variables defined in `packages/shared/src/env.ts`
- **Stripe Plan Mapping:** `packages/shared/billing/stripePlanMap.ts`
- **Migrations:** `supabase/migrations/` directory

---

**Last Updated:** 2025-01-XX  
**Maintained By:** Cliply Backend Team

