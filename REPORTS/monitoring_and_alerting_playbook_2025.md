# Cliply Backend – Monitoring & Alerting Playbook

**Last Updated:** 2025-01-XX  
**Purpose:** Practical guide for monitoring system health and responding to alerts  
**Scope:** Vercel (API), Supabase (DB), Sentry (errors), Worker (jobs), Stripe (billing), External APIs

This playbook helps on-call engineers and operators quickly identify issues, understand what's happening, and take appropriate action. Use this document for daily monitoring routines and incident response.

**⚠️ This is an operations document only. No runtime code changes.**

---

## 1. Overview

### What This Playbook Is For

This document provides:

- **What to watch** – Key metrics, logs, and dashboards to monitor
- **Which alerts exist** – Recommended alert configurations and thresholds
- **What to do when alerts fire** – Step-by-step incident playbooks
- **How to check system health** – Quick verification procedures

### Main Monitoring Surfaces

- **Vercel** – API errors, latency, deployment status
- **Supabase** – Database health, connection pool, slow queries, RLS performance
- **Sentry** – Error tracking, performance traces, release monitoring
- **Worker** – Job processing, pipeline failures, stuck jobs
- **External APIs** – Stripe webhooks, YouTube/TikTok API status

### General Principles

- **Detect issues early** – Set alerts before users notice problems
- **Reduce false positives** – Use appropriate thresholds and filters
- **Keep alerts actionable** – Each alert should have a clear remediation path
- **Monitor the critical path** – Focus on user-facing features (publishing, uploads, billing)

---

## 2. Key Signals & Dashboards

### 2.1 Vercel

**What to Monitor:**

- **API Route Logs** – Errors and latency for `/api/*` endpoints
- **Deployment Status** – Failed builds, rollbacks
- **Function Execution Time** – Slow API routes
- **Error Rate** – 5xx responses from API routes

**Where to Look:**

- [ ] **Vercel Dashboard → Logs**
  - Filter by route: `/api/upload/*`, `/api/publish/*`, `/api/cron/*`
  - Check for 5xx errors, timeouts, memory issues
  - Review recent deployments for correlation

- [ ] **Vercel Dashboard → Analytics** (if enabled)
  - View latency percentiles (p50, p95, p99)
  - Check error rate trends
  - Identify slow endpoints

- [ ] **Vercel Dashboard → Functions**
  - Monitor function execution count
  - Check for cold start issues
  - Review memory usage

**Key Endpoints to Monitor:**

- `/api/upload/init` – Upload initialization
- `/api/upload/complete` – Upload completion
- `/api/publish/youtube` – YouTube publishing
- `/api/publish/tiktok` – TikTok publishing
- `/api/cron/scan-schedules` – Scheduled publish scanning
- `/api/webhooks/stripe` – Stripe webhook handler
- `/api/readyz` – Public health check
- `/api/admin/readyz` – Admin health check

---

### 2.2 Sentry

**What to Monitor:**

- **Error Rate** – Total errors per service (web vs worker)
- **Error Types** – New error patterns, recurring issues
- **Performance Traces** – Slow API routes, database queries
- **Release Health** – Errors by deployment/release

**Where to Look:**

- [ ] **Sentry Dashboard → Issues**
  - Filter by service: `apps/web` or `apps/worker`
  - Sort by frequency or first seen
  - Check for new error types (tagged with `severity=critical`)

- [ ] **Sentry Dashboard → Performance**
  - View traces for key endpoints:
    - `/api/upload/init` (should be < 2s)
    - `/api/publish/youtube` (should be < 5s)
    - `/api/publish/tiktok` (should be < 5s)
    - `/api/cron/scan-schedules` (should be < 10s)
  - Check for slow database queries
  - Identify N+1 query patterns

- [ ] **Sentry Dashboard → Releases**
  - Monitor error rate after deployments
  - Check for regression in new releases
  - Review release health trends

**Key Event Tags to Filter:**

- `service:api` or `service:worker`
- `feature:publishing` – Publishing-related errors
- `feature:billing` – Stripe/webhook errors
- `severity:critical` – Critical errors requiring immediate attention
- `job_type:PUBLISH_YOUTUBE` or `job_type:PUBLISH_TIKTOK` – Publishing job failures

---

### 2.3 Supabase

**What to Monitor:**

- **Database Health** – CPU usage, connection pool, active connections
- **Query Performance** – Slow queries, query timeouts
- **Storage** – Disk usage, backup status
- **RLS Performance** – Policy evaluation time (if visible)

**Where to Look:**

- [ ] **Supabase Dashboard → Database → Performance**
  - Check CPU usage (should be < 80% sustained)
  - Monitor active connections (should be < 80% of pool)
  - Review slow query log (queries > 1s)

- [ ] **Supabase Dashboard → Database → Logs**
  - Check for connection errors
  - Review query timeouts
  - Monitor RLS policy evaluation (if logged)

- [ ] **Supabase Dashboard → Database → Backups**
  - Verify automated backups are running
  - Check backup retention period
  - Note last successful backup

**Key Tables to Monitor:**

- `jobs` – High write volume, check for slow queries
- `projects` – User-facing data, check for slow SELECT queries
- `clips` – User-facing data, check for slow SELECT queries
- `workspace_members` – Auth-critical, check for slow RLS evaluation
- `subscriptions` – Billing-critical, check for sync issues

---

### 2.4 Worker

**What to Monitor:**

- **Job Processing** – Jobs stuck in `running` or `queued` too long
- **Job Failure Rates** – Failures by job type (TRANSCRIBE, PUBLISH_YOUTUBE, etc.)
- **Worker Heartbeat** – Worker health and availability
- **Pipeline Performance** – Time to complete each pipeline type

**Where to Look:**

- [ ] **Database Query: Stuck Jobs**
  ```sql
  -- Jobs stuck in running for > 5 minutes
  SELECT id, kind, status, worker_id, last_heartbeat, created_at
  FROM jobs
  WHERE status = 'running'
    AND last_heartbeat < NOW() - INTERVAL '5 minutes'
  ORDER BY last_heartbeat ASC;
  ```

- [ ] **Database Query: Job Failure Rates**
  ```sql
  -- Failure rate by job type (last 24 hours)
  SELECT 
    kind,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
    COUNT(*) as total_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / COUNT(*), 2) as failure_rate_pct
  FROM jobs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY kind
  ORDER BY failed_count DESC;
  ```

- [ ] **Database Query: Queue Depth**
  ```sql
  -- Jobs queued but not running
  SELECT kind, COUNT(*) as queued_count
  FROM jobs
  WHERE status = 'queued'
    AND run_after <= NOW()
  GROUP BY kind
  ORDER BY queued_count DESC;
  ```

- [ ] **Worker Logs** (if accessible)
  - Check for worker crashes or restarts
  - Monitor job processing times
  - Review error messages from failed jobs

**Key Job Types to Monitor:**

- `PUBLISH_YOUTUBE` – Critical for user publishing
- `PUBLISH_TIKTOK` – Critical for user publishing
- `CLIP_RENDER` – Core feature, high volume
- `TRANSCRIBE` – Core feature, external API dependency
- `HIGHLIGHT_DETECT` – Core feature, AI dependency

---

### 2.5 Stripe

**What to Monitor:**

- **Webhook Delivery** – Success/failure rates for webhook events
- **Subscription State** – Failed payments, cancellations, plan changes
- **API Errors** – Stripe API failures or rate limits

**Where to Look:**

- [ ] **Stripe Dashboard → Webhooks**
  - Check webhook delivery success rate (should be > 99%)
  - Review failed webhook deliveries
  - Check for webhook endpoint errors (5xx responses)

- [ ] **Stripe Dashboard → Customers → Subscriptions**
  - Monitor failed payment attempts
  - Check for subscription cancellations
  - Review plan changes

- [ ] **Stripe Dashboard → Events**
  - Filter for `customer.subscription.updated`
  - Filter for `customer.subscription.deleted`
  - Check for `invoice.payment_failed` events

**Key Webhook Events:**

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

---

### 2.6 External APIs

**What to Monitor:**

- **YouTube API** – Rate limits, authentication errors, API downtime
- **TikTok API** – Rate limits, authentication errors, API downtime
- **Deepgram API** – Transcription service availability (if used)

**Where to Look:**

- [ ] **Sentry Errors** – Filter for `feature:publishing` or `job_type:PUBLISH_*`
- [ ] **Worker Logs** – Check for API error messages
- [ ] **Job Failures** – Review error payloads for PUBLISH_YOUTUBE/PUBLISH_TIKTOK jobs
- [ ] **External Status Pages:**
  - YouTube API: `https://status.youtube.com` (if available)
  - TikTok API: Check TikTok Developer Portal for status

---

## 3. Recommended Alerts

### 3.1 Sentry Alerts

#### Alert: High Error Rate (Web API)

- **Threshold:** > 50 errors in 5 minutes for `service:api`
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Indicates widespread API failures, possible deployment issue or database outage
- **Likely Causes:** Bad deployment, Supabase outage, environment variable misconfiguration

**Configuration:**
- Sentry Dashboard → Alerts → Create Alert
- Condition: Error count > 50 in 5 minutes
- Filter: `service:api` or `service:apps/web`
- Action: Email + Slack webhook

---

#### Alert: High Error Rate (Worker)

- **Threshold:** > 20 errors in 5 minutes for `service:worker`
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Worker may be crashing or failing to process jobs
- **Likely Causes:** Worker crash, external API outage, database connection issues

**Configuration:**
- Sentry Dashboard → Alerts → Create Alert
- Condition: Error count > 20 in 5 minutes
- Filter: `service:worker` or `service:apps/worker`
- Action: Email + Slack webhook

---

#### Alert: Critical Publishing Errors

- **Threshold:** Any error tagged with `severity:critical` AND `feature:publishing`
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Publishing is core functionality; critical errors indicate complete failure
- **Likely Causes:** OAuth token expired, API rate limit, external API outage

**Configuration:**
- Sentry Dashboard → Alerts → Create Alert
- Condition: New issue with tags `severity:critical` AND `feature:publishing`
- Action: Email + Slack webhook (immediate)

---

#### Alert: Publishing Job Failure Spike

- **Threshold:** > 10 failed `PUBLISH_YOUTUBE` or `PUBLISH_TIKTOK` jobs in 10 minutes
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Users cannot publish content; likely external API issue
- **Likely Causes:** YouTube/TikTok API outage, OAuth token expiration, rate limiting

**Configuration:**
- Sentry Dashboard → Alerts → Create Alert
- Condition: Error count > 10 in 10 minutes
- Filter: `job_type:PUBLISH_YOUTUBE` OR `job_type:PUBLISH_TIKTOK`
- Action: Email + Slack webhook

---

### 3.2 Supabase Alerts

#### Alert: High CPU Usage

- **Threshold:** CPU > 80% for > 5 minutes
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Database may be overloaded, queries may be slow, risk of connection pool exhaustion
- **Likely Causes:** Expensive queries, missing indexes, high traffic, connection leaks

**Configuration:**
- Supabase Dashboard → Settings → Alerts (if available)
- Or use external monitoring (UptimeRobot, Datadog) to query Supabase metrics API
- Action: Email + Slack webhook

---

#### Alert: Connection Pool Exhaustion

- **Threshold:** Active connections > 80% of pool size for > 2 minutes
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** New requests may fail with connection errors
- **Likely Causes:** Connection leaks, high traffic, long-running queries

**Configuration:**
- Supabase Dashboard → Settings → Alerts (if available)
- Or use external monitoring to query connection metrics
- Action: Email + Slack webhook

---

#### Alert: Slow Query Spike

- **Threshold:** Queries > 2 seconds appearing in slow query log
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** User-facing endpoints may be slow, risk of timeouts
- **Likely Causes:** Missing indexes, inefficient queries, table bloat

**Configuration:**
- Supabase Dashboard → Database → Performance → Slow Queries
- Set up alert for queries > 2s (manual monitoring or external tool)
- Action: Email + Slack webhook

---

#### Alert: Disk Usage High

- **Threshold:** Disk usage > 85%
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Database may stop accepting writes, backups may fail
- **Likely Causes:** Large tables, unoptimized storage, backup retention too long

**Configuration:**
- Supabase Dashboard → Settings → Alerts (if available)
- Or use external monitoring
- Action: Email + Slack webhook

---

### 3.3 Vercel / API Alerts

#### Alert: High 5xx Error Rate

- **Threshold:** > 5% of requests return 5xx in 5 minutes
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Users are experiencing errors, possible deployment issue
- **Likely Causes:** Bad deployment, database outage, environment variable issues

**Configuration:**
- Vercel Dashboard → Analytics → Alerts (if available)
- Or use external monitoring (UptimeRobot, Pingdom) to hit `/api/readyz`
- Action: Email + Slack webhook

---

#### Alert: High Latency (Key Endpoints)

- **Threshold:** p95 latency > 5s for `/api/upload/init` or `/api/publish/*` in 5 minutes
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Users experience slow uploads/publishing
- **Likely Causes:** Database slow queries, external API delays, cold starts

**Configuration:**
- Vercel Dashboard → Analytics → Performance (if available)
- Or use Sentry Performance monitoring
- Action: Email + Slack webhook

---

### 3.4 Synthetic Uptime Checks

#### Alert: Health Check Failure

- **Endpoint:** `GET https://app.cliply.ai/api/readyz`
- **Expected Response:** HTTP 200, JSON: `{ "ok": true, "service": "api", "checks": { "env": true, "db": true } }`
- **Check Frequency:** Every 1 minute
- **Failure Threshold:** 2 consecutive failures
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Indicates complete API failure or database outage

**Configuration:**
- Use UptimeRobot, Pingdom, or similar service
- Monitor `/api/readyz` endpoint
- Action: Email + SMS (if critical)

---

#### Alert: Admin Health Check Failure

- **Endpoint:** `GET https://app.cliply.ai/api/admin/readyz`
- **Expected Response:** HTTP 200, JSON: `{ "ok": true, ... }`
- **Check Frequency:** Every 5 minutes
- **Failure Threshold:** 2 consecutive failures
- **Notification:** Email to founder, Slack channel `#alerts`
- **Why It Matters:** Indicates backend readiness issues (env vars, DB, etc.)

**Configuration:**
- Use UptimeRobot or similar (requires authentication header)
- Monitor `/api/admin/readyz` endpoint
- Action: Email + Slack webhook

---

## 4. When an Alert Fires – Playbooks

### 4.1 API Error Spike (5xx on Web/API)

**Symptoms:**
- Sentry shows spike in errors for `service:api`
- Vercel logs show many 5xx responses
- Users report errors when using the app
- `/api/readyz` may return 503

**Likely Causes:**
- Recent deployment introduced a bug
- Supabase database outage or connection issues
- Missing or incorrect environment variables
- External API outage (Stripe, YouTube, TikTok)

**Immediate Checks:**

- [ ] **Check Recent Deployments:**
  - [ ] Go to Vercel Dashboard → Deployments
  - [ ] Check if deployment occurred in last 10 minutes
  - [ ] Review deployment logs for errors
  - [ ] If recent deployment, consider rollback

- [ ] **Check Health Endpoints:**
  - [ ] Call `GET /api/readyz` – Check if DB connection is healthy
  - [ ] Call `GET /api/admin/readyz` – Check backend readiness
  - [ ] Review response body for specific failures

- [ ] **Check Sentry:**
  - [ ] Open Sentry Dashboard → Issues
  - [ ] Filter by `service:api` and last 15 minutes
  - [ ] Review error messages and stack traces
  - [ ] Check for common patterns (database errors, env var errors)

- [ ] **Check Vercel Logs:**
  - [ ] Go to Vercel Dashboard → Logs
  - [ ] Filter by route: `/api/*`
  - [ ] Look for 5xx errors and error messages
  - [ ] Check for correlation with deployment time

- [ ] **Check Supabase:**
  - [ ] Go to Supabase Dashboard → Database → Performance
  - [ ] Check CPU usage and connection pool
  - [ ] Review slow query log
  - [ ] Check Supabase status page: `https://status.supabase.com`

**Remediation Steps:**

- [ ] **If Recent Deployment:**
  - [ ] Rollback to previous deployment in Vercel Dashboard
  - [ ] Verify errors stop after rollback
  - [ ] Investigate deployment issue in staging

- [ ] **If Database Issue:**
  - [ ] Check Supabase Dashboard for outages
  - [ ] Review connection pool usage
  - [ ] If connection pool exhausted, restart Vercel functions (redeploy)
  - [ ] If slow queries, see Section 4.4

- [ ] **If Environment Variable Issue:**
  - [ ] Check Vercel Dashboard → Settings → Environment Variables
  - [ ] Verify required variables are set (see `REPORTS/production_deployment_checklist_2025.md`)
  - [ ] Redeploy after fixing variables

- [ ] **If External API Issue:**
  - [ ] Check Stripe status: `https://status.stripe.com`
  - [ ] Check YouTube/TikTok API status
  - [ ] Monitor for resolution

**Verification:**

- [ ] **After Remediation:**
  - [ ] Call `/api/readyz` – Should return 200
  - [ ] Check Sentry – Error rate should drop
  - [ ] Test a user flow (upload, publish) in staging
  - [ ] Monitor for 10 minutes to ensure errors don't return

**Follow-up:**

- [ ] **Root Cause Analysis:**
  - [ ] Document what caused the spike
  - [ ] Update runbook if new pattern discovered
  - [ ] Add alert if issue was undetected

- [ ] **Prevention:**
  - [ ] Review deployment process (add staging tests)
  - [ ] Add pre-deployment health checks
  - [ ] Improve error handling for external APIs

---

### 4.2 Worker Job Failures Spike

**Symptoms:**
- Many failed jobs in database (status = 'failed')
- Sentry shows errors for `service:worker` or `job_type:PUBLISH_*`
- Users report publishing not working
- Job failure rate > 10% for specific job type

**Likely Causes:**
- External API outage (YouTube, TikTok)
- OAuth token expiration
- External API rate limiting
- Worker crash or restart
- Database connection issues

**Immediate Checks:**

- [ ] **Check Job Failure Rate:**
  - [ ] Run SQL query (see Section 2.4) to get failure rate by job type
  - [ ] Identify which job types are failing (PUBLISH_YOUTUBE, PUBLISH_TIKTOK, etc.)
  - [ ] Check if failures are recent (last 10 minutes) or ongoing

- [ ] **Check Sentry:**
  - [ ] Open Sentry Dashboard → Issues
  - [ ] Filter by `service:worker` or `job_type:PUBLISH_*`
  - [ ] Review error messages (API errors, OAuth errors, rate limits)
  - [ ] Check for patterns (all YouTube jobs failing, all TikTok jobs failing)

- [ ] **Check External API Status:**
  - [ ] YouTube API: Check for known outages
  - [ ] TikTok API: Check TikTok Developer Portal
  - [ ] Review error messages for API-specific errors

- [ ] **Check Worker Logs:**
  - [ ] Review worker logs for crash messages
  - [ ] Check for connection errors
  - [ ] Verify worker is running and processing jobs

- [ ] **Check OAuth Tokens:**
  - [ ] Query `connected_accounts` table for recent failures
  - [ ] Check if tokens are expired (if error messages indicate OAuth issues)
  - [ ] Verify encryption key is correct (if tokens are encrypted)

**Remediation Steps:**

- [ ] **If External API Outage:**
  - [ ] Monitor external API status page
  - [ ] Pause worker (optional) to prevent retry spam
  - [ ] Wait for API to recover
  - [ ] Re-queue failed jobs after recovery (see admin endpoints)

- [ ] **If OAuth Token Expiration:**
  - [ ] Identify affected `connected_accounts`
  - [ ] Notify users to reconnect accounts
  - [ ] Or implement automatic token refresh (if supported)

- [ ] **If Rate Limiting:**
  - [ ] Check rate limit errors in Sentry
  - [ ] Implement backoff or rate limiting in worker
  - [ ] Re-queue failed jobs with delay

- [ ] **If Worker Crash:**
  - [ ] Restart worker process
  - [ ] Check worker logs for crash cause
  - [ ] Fix underlying issue (memory leak, unhandled exception)

- [ ] **Use Admin Job Endpoints:**
  - [ ] **Retry Failed Jobs:** `POST /api/admin/jobs/[id]/retry`
  - [ ] **Cancel Stuck Jobs:** `POST /api/admin/jobs/[id]/cancel`
  - [ ] **Unlock Jobs:** `POST /api/admin/jobs/[id]/unlock`
  - [ ] Use these to manually fix specific jobs

**Verification:**

- [ ] **After Remediation:**
  - [ ] Check job failure rate – Should drop to < 5%
  - [ ] Test publishing in staging (YouTube and TikTok)
  - [ ] Monitor Sentry for new errors
  - [ ] Verify worker is processing jobs successfully

**Follow-up:**

- [ ] **Root Cause Analysis:**
  - [ ] Document which job types failed and why
  - [ ] Review error patterns
  - [ ] Update runbook with new patterns

- [ ] **Prevention:**
  - [ ] Add retry logic with exponential backoff
  - [ ] Implement OAuth token refresh
  - [ ] Add rate limiting handling
  - [ ] Improve error messages for debugging

---

### 4.3 Cron / Scheduling Issues

**Symptoms:**
- Scheduled posts not going out at expected times
- Users report missing scheduled publishes
- `/api/cron/scan-schedules` shows errors in Sentry
- Vercel Cron logs show failures

**Likely Causes:**
- Vercel Cron not executing
- `/api/cron/scan-schedules` endpoint errors
- Jobs not being created from schedules
- Worker not processing scheduled jobs

**Immediate Checks:**

- [ ] **Check Vercel Cron Logs:**
  - [ ] Go to Vercel Dashboard → Cron Jobs
  - [ ] Check execution logs for `/api/cron/scan-schedules`
  - [ ] Verify cron is executing on schedule (every minute)
  - [ ] Review error messages if executions are failing

- [ ] **Check Cron Endpoint:**
  - [ ] Review Sentry for errors from `/api/cron/scan-schedules`
  - [ ] Check Vercel logs for 5xx responses
  - [ ] Verify `CRON_SECRET` is set correctly

- [ ] **Check Job Queue:**
  - [ ] Query database for schedules that should have fired:
    ```sql
    SELECT id, workspace_id, clip_id, connected_account_id, 
           publish_at, status, created_at
    FROM schedules
    WHERE publish_at <= NOW()
      AND status = 'scheduled'
    ORDER BY publish_at ASC
    LIMIT 20;
    ```
  - [ ] Check if jobs were created for these schedules:
    ```sql
    SELECT id, kind, status, payload->>'schedule_id' as schedule_id
    FROM jobs
    WHERE kind = 'PUBLISH_YOUTUBE' OR kind = 'PUBLISH_TIKTOK'
    ORDER BY created_at DESC
    LIMIT 20;
    ```

- [ ] **Check Worker:**
  - [ ] Verify worker is running and processing jobs
  - [ ] Check for stuck jobs (see Section 2.4)
  - [ ] Review worker logs for errors

**Remediation Steps:**

- [ ] **If Vercel Cron Not Executing:**
  - [ ] Check Vercel Cron configuration in `vercel.json`
  - [ ] Verify cron job is enabled in Vercel Dashboard
  - [ ] Check Vercel plan (Cron requires Hobby plan or higher)
  - [ ] Manually trigger cron endpoint to test: `POST /api/cron/scan-schedules` with `X-CRON-SECRET` header

- [ ] **If Cron Endpoint Errors:**
  - [ ] Check Sentry for specific error messages
  - [ ] Verify `CRON_SECRET` matches Vercel's secret
  - [ ] Check database connection (cron endpoint queries schedules)
  - [ ] Review endpoint code for bugs

- [ ] **If Jobs Not Created:**
  - [ ] Check cron endpoint logs for errors creating jobs
  - [ ] Verify `worker_enqueue_job` RPC function exists
  - [ ] Check database constraints (foreign keys, etc.)
  - [ ] Manually create test job to verify job creation works

- [ ] **If Jobs Created But Not Processing:**
  - [ ] Check worker is running
  - [ ] Review stuck jobs (see Section 4.2)
  - [ ] Use admin endpoints to retry/unlock jobs

**Verification:**

- [ ] **After Remediation:**
  - [ ] Create a test schedule with `publish_at` = 2 minutes from now
  - [ ] Wait for cron to execute (check Vercel Cron logs)
  - [ ] Verify job was created for the schedule
  - [ ] Verify job was processed by worker
  - [ ] Check that publish occurred on platform (YouTube/TikTok)

**Follow-up:**

- [ ] **Root Cause Analysis:**
  - [ ] Document what broke (cron, endpoint, job creation, worker)
  - [ ] Review cron execution logs
  - [ ] Update runbook with new patterns

- [ ] **Prevention:**
  - [ ] Add monitoring for cron execution (alert if no executions in 5 minutes)
  - [ ] Add logging for schedule processing
  - [ ] Test cron in staging before production

---

### 4.4 Database Load / Latency Problems

**Symptoms:**
- Supabase CPU > 80%
- Slow queries in Supabase Dashboard
- API endpoints timing out
- Connection pool exhaustion errors
- Users report slow page loads

**Likely Causes:**
- Expensive queries (missing indexes, full table scans)
- High traffic spike
- Connection leaks (connections not closed)
- Table bloat (unoptimized storage)
- Long-running transactions

**Immediate Checks:**

- [ ] **Check Supabase Metrics:**
  - [ ] Go to Supabase Dashboard → Database → Performance
  - [ ] Review CPU usage (should be < 80%)
  - [ ] Check active connections (should be < 80% of pool)
  - [ ] Review slow query log (queries > 1s)

- [ ] **Identify Expensive Queries:**
  - [ ] Review slow query log in Supabase Dashboard
  - [ ] Look for queries on `jobs`, `projects`, `clips` tables
  - [ ] Check for missing indexes (queries doing full table scans)
  - [ ] Identify queries with high execution time

- [ ] **Check Connection Pool:**
  - [ ] Review active connections count
  - [ ] Check for connection leaks (connections not closing)
  - [ ] Review Vercel function connection usage

- [ ] **Check Recent Changes:**
  - [ ] Review recent deployments (new queries, new features)
  - [ ] Check for new API endpoints that may be hitting DB hard
  - [ ] Review worker changes (may be creating many jobs)

**Remediation Steps:**

- [ ] **Short-Term Mitigations:**
  - [ ] **Rate Limiting:** Enable rate limiting on high-traffic endpoints
  - [ ] **Temporary Feature Gating:** Disable non-critical features temporarily
  - [ ] **Connection Pooling:** Verify Vercel functions are using connection pooling
  - [ ] **Kill Long-Running Queries:** If safe, kill queries running > 30s
    ```sql
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE state = 'active'
      AND query_start < NOW() - INTERVAL '30 seconds'
      AND pid != pg_backend_pid();
    ```

- [ ] **Add Missing Indexes:**
  - [ ] Identify slow queries from slow query log
  - [ ] Add indexes on frequently queried columns:
    ```sql
    -- Example: Add index on jobs table
    CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after 
    ON jobs(status, run_after) 
    WHERE status = 'queued';
    ```
  - [ ] Test indexes in staging first

- [ ] **Optimize Queries:**
  - [ ] Review query plans using `EXPLAIN ANALYZE`
  - [ ] Refactor queries to use indexes
  - [ ] Add query timeouts to prevent runaway queries

- [ ] **Long-Term Fixes:**
  - [ ] **Table Maintenance:** Run `VACUUM ANALYZE` on bloated tables
  - [ ] **Connection Leak Fix:** Review code for unclosed connections
  - [ ] **Query Optimization:** Refactor expensive queries
  - [ ] **Caching:** Add caching layer for frequently accessed data

**Verification:**

- [ ] **After Remediation:**
  - [ ] Check Supabase CPU – Should drop to < 60%
  - [ ] Review slow query log – Should see fewer slow queries
  - [ ] Test API endpoints – Should respond in < 2s
  - [ ] Monitor for 1 hour to ensure issue is resolved

**Follow-up:**

- [ ] **Root Cause Analysis:**
  - [ ] Document which queries were slow
  - [ ] Review query patterns
  - [ ] Update runbook with optimization learnings

- [ ] **Prevention:**
  - [ ] Add query performance monitoring
  - [ ] Set up alerts for slow queries
  - [ ] Review new queries in code reviews
  - [ ] Add database performance tests

---

## 5. Daily / Weekly Monitoring Routines

### 5.1 Daily Quick Check (5–10 minutes)

Perform this routine every morning (or at start of on-call shift):

- [ ] **Check Sentry for New Errors:**
  - [ ] Open Sentry Dashboard → Issues
  - [ ] Filter by "First Seen: Last 24 hours"
  - [ ] Review new error types
  - [ ] Check for critical errors (tagged `severity:critical`)
  - [ ] Triage new issues (acknowledge, assign, or ignore)

- [ ] **Scan Vercel Logs for Spikes:**
  - [ ] Go to Vercel Dashboard → Logs
  - [ ] Review error rate for last 24 hours
  - [ ] Check for 5xx spikes
  - [ ] Review deployment status (any failed deployments?)

- [ ] **Spot-Check Supabase Metrics:**
  - [ ] Go to Supabase Dashboard → Database → Performance
  - [ ] Check CPU usage (should be < 60% average)
  - [ ] Check active connections (should be < 50% of pool)
  - [ ] Review slow query log (any queries > 2s?)

- [ ] **Check Health Endpoints:**
  - [ ] Call `GET /api/readyz` – Should return 200
  - [ ] Call `GET /api/admin/readyz` – Should return 200
  - [ ] Review response bodies for any warnings

- [ ] **Review Job Failure Rate:**
  - [ ] Run SQL query (see Section 2.4) for job failure rate
  - [ ] Check if any job type has > 5% failure rate
  - [ ] Review failed jobs in Sentry if rate is high

**Time Budget:** 5–10 minutes  
**Action Threshold:** If any critical issues found, escalate to incident playbook (Section 4)

---

### 5.2 Weekly Deeper Review

Perform this routine once per week (e.g., Monday morning):

- [ ] **Review Job Failure Rates by Pipeline:**
  - [ ] Run SQL query for failure rates by job type (last 7 days)
  - [ ] Identify job types with high failure rates (> 5%)
  - [ ] Review error patterns in Sentry
  - [ ] Document trends (improving or worsening)

- [ ] **Review Webhook Failures (Stripe):**
  - [ ] Go to Stripe Dashboard → Webhooks
  - [ ] Review webhook delivery success rate (last 7 days)
  - [ ] Check for failed deliveries
  - [ ] Review error responses (5xx, timeouts)
  - [ ] Verify subscription sync is working (spot-check a few workspaces)

- [ ] **Confirm Cron + Scheduled Publishes:**
  - [ ] Check Vercel Cron execution logs (last 7 days)
  - [ ] Verify cron is executing on schedule
  - [ ] Create a test schedule and verify it fires
  - [ ] Spot-check a few real scheduled publishes (verify they went out)

- [ ] **Review Database Performance:**
  - [ ] Check Supabase Dashboard → Database → Performance
  - [ ] Review slow query trends (are queries getting slower?)
  - [ ] Check table sizes (any tables growing unexpectedly?)
  - [ ] Review connection pool usage trends

- [ ] **Review Sentry Trends:**
  - [ ] Open Sentry Dashboard → Issues
  - [ ] Review error rate trends (last 7 days)
  - [ ] Check for recurring issues
  - [ ] Review performance trends (are endpoints getting slower?)

- [ ] **Review Deployment Health:**
  - [ ] Go to Vercel Dashboard → Deployments
  - [ ] Review deployments from last week
  - [ ] Check for failed builds or rollbacks
  - [ ] Review deployment frequency (too many? too few?)

**Time Budget:** 30–60 minutes  
**Action Threshold:** Document findings, create tickets for improvements

---

## 6. Integration with Existing Docs

### 6.1 Connection to Other Runbooks

This monitoring playbook connects to other operational documents:

- [ ] **Production Deployment Checklist** (`REPORTS/production_deployment_checklist_2025.md`)
  - Use when verifying environment variables during incidents
  - Reference when checking Stripe webhook configuration
  - Use when verifying worker environment variables

- [ ] **Backup & Recovery Runbook** (`REPORTS/backup_and_recovery_runbook_2025.md`)
  - **If data loss is suspected:** Switch to Backup & Recovery Runbook Section 4.1 (Accidental Data Deletion)
  - **If database corruption detected:** Switch to Backup & Recovery Runbook Section 4.3 (Large-Scale Data Corruption)
  - **If Supabase outage confirmed:** Switch to Backup & Recovery Runbook Section 4.4 (Supabase Outage)

- [ ] **Full Readiness Audit** (`REPORTS/full_readiness_audit_2025.md`)
  - Reference for understanding system architecture
  - Use when investigating feature-specific issues
  - Reference for understanding data model and relationships

### 6.2 Escalation Paths

When an incident escalates:

1. **Start Here:** Use this monitoring playbook (Section 4) for initial triage
2. **If Data Loss Suspected:** Switch to Backup & Recovery Runbook
3. **If Infrastructure Issue:** Switch to Production Deployment Checklist
4. **If Unknown Issue:** Review Full Readiness Audit for system context

### 6.3 Cross-References

- **Environment Variables:** See `REPORTS/production_deployment_checklist_2025.md` Section 3
- **Health Endpoints:** See `REPORTS/production_deployment_checklist_2025.md` Section 10
- **Admin Job Endpoints:** See `REPORTS/production_deployment_checklist_2025.md` Section 7
- **Database Schema:** See `REPORTS/full_readiness_audit_2025.md` Section 1
- **Recovery Procedures:** See `REPORTS/backup_and_recovery_runbook_2025.md` Section 5

---

## 7. Appendix

### 7.1 Monitoring Tool Links

**Sentry:**
- Dashboard: `https://sentry.io/organizations/<org>/` (replace with your org)
- Project: `apps/web` and `apps/worker`
- Alerts: Sentry Dashboard → Alerts → Create Alert

**Supabase:**
- Dashboard: `https://supabase.com/dashboard/project/<project-id>`
- Monitoring: Dashboard → Database → Performance
- Status: `https://status.supabase.com`

**Vercel:**
- Dashboard: `https://vercel.com/<org>/<project>`
- Logs: Dashboard → Logs
- Analytics: Dashboard → Analytics (if enabled)
- Cron: Dashboard → Cron Jobs

**Stripe:**
- Dashboard: `https://dashboard.stripe.com`
- Webhooks: Dashboard → Developers → Webhooks
- Status: `https://status.stripe.com`

### 7.2 Health Endpoint Details

**Public Health Check:**
- Endpoint: `GET /api/readyz`
- Expected: HTTP 200
- Response: `{ "ok": true, "service": "api", "checks": { "env": true, "db": true } }`
- Use for: Uptime monitoring, load balancer health checks

**Admin Health Check:**
- Endpoint: `GET /api/admin/readyz`
- Expected: HTTP 200
- Response: `{ "ok": true, ... }` (detailed readiness report)
- Use for: Internal monitoring, detailed health checks
- Requires: Service role key or admin authentication

### 7.3 Admin Job Endpoints

**Retry Failed Job:**
- Endpoint: `POST /api/admin/jobs/[id]/retry`
- Use when: Job failed but should be retried
- Requires: Admin authentication

**Cancel Job:**
- Endpoint: `POST /api/admin/jobs/[id]/cancel`
- Use when: Job is stuck or should be cancelled
- Requires: Admin authentication

**Unlock Job:**
- Endpoint: `POST /api/admin/jobs/[id]/unlock`
- Use when: Job is stuck in `running` state (worker crashed)
- Requires: Admin authentication

### 7.4 Important Reminders

- **Don't add secrets or real project IDs into this doc** – Use placeholders like `<project-id>`
- **Test alerts in staging first** – Verify alert thresholds before enabling in production
- **Document alert changes** – Update this playbook when adding new alerts
- **Review alerts quarterly** – Tune thresholds based on false positive rates

### 7.5 Quick Reference

**Critical Alerts:**
- High error rate (web/worker)
- Publishing job failures
- Database CPU/connections
- Health check failures

**Key Dashboards:**
- Sentry → Issues (filter by service)
- Supabase → Database → Performance
- Vercel → Logs (filter by route)
- Stripe → Webhooks

**Health Checks:**
- `/api/readyz` – Public health
- `/api/admin/readyz` – Admin health

**Admin Tools:**
- `/api/admin/jobs/[id]/retry` – Retry job
- `/api/admin/jobs/[id]/cancel` – Cancel job
- `/api/admin/jobs/[id]/unlock` – Unlock job

---

**Last Updated:** 2025-01-XX  
**Maintained By:** Cliply Backend Team

