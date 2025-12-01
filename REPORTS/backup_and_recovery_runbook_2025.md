# Cliply Backend – Backup & Recovery Runbook

**Last Updated:** 2025-01-XX  
**Purpose:** Step-by-step procedures for recovering from data loss, corruption, or outages  
**Scope:** Supabase Postgres, Stripe billing, Worker jobs, External platforms (TikTok/YouTube)

This runbook provides concrete procedures for responding to production data incidents. Use this when data is lost, corrupted, or when Supabase is unavailable.

**⚠️ Always test recovery procedures in a staging environment or cloned project before executing on production.**

---

## 1. Overview

### What This Runbook Is For

This document covers recovery procedures for production incidents involving:

- **Data loss** – Accidental deletion of workspaces, projects, clips, or user data
- **Data corruption** – Incorrect data due to bugs, bad migrations, or manual SQL errors
- **Schema issues** – Broken migrations, missing columns, or RLS policy failures
- **Service outages** – Supabase downtime, Stripe webhook failures, or worker unavailability

### Data Locations

- **Supabase Postgres** – Primary data store (workspaces, projects, clips, jobs, accounts, billing)
- **Stripe** – Subscription and payment data (synced to Supabase `subscriptions` table)
- **External Platforms** – TikTok and YouTube (published content, OAuth tokens stored in Supabase)
- **Storage** – Video files and rendered clips (Supabase Storage or external S3)

### Recovery Objectives

- **RPO (Recovery Point Objective):** Target maximum data loss
  - **Target:** 1 hour (Supabase automated backups run hourly)
  - **Reality:** Depends on backup retention and last successful backup

- **RTO (Recovery Time Objective):** Target maximum downtime
  - **Target:** 2-4 hours for full database restore
  - **Target:** 30-60 minutes for selective table/row restore
  - **Reality:** Depends on data volume and complexity of recovery

---

## 2. Critical Data Map

### 2.1 Authentication & Workspaces

**Tables:** `workspaces`, `workspace_members`, `users`

**Why Critical:**
- Users cannot log in if `users` table is corrupted
- Workspace access breaks if `workspace_members` is lost
- All other data is workspace-scoped (cascade deletes if workspace is deleted)

**Impact of Loss:**
- **Users:** Cannot authenticate, lose access to all workspaces
- **Workspaces:** All projects, clips, and jobs become orphaned
- **Workspace Members:** Team members lose access, RBAC breaks

**External Dependencies:**
- Supabase Auth (separate from `users` table)
- Stripe (workspace billing via `workspaces.stripe_customer_id`)

**Recovery Priority:** **CRITICAL** – Restore immediately

---

### 2.2 Projects & Clips

**Tables:** `projects`, `clips`, `clip_products` (if using dropshipping)

**Why Critical:**
- Core user content (source videos and generated clips)
- Projects reference workspace and source files
- Clips reference projects and have rendered video files

**Impact of Loss:**
- **Projects:** Users lose source videos and cannot generate new clips
- **Clips:** Users lose generated content, published clips become orphaned
- **Files:** Video files may still exist in storage but become unreferenced

**External Dependencies:**
- Storage (Supabase Storage or S3) – video files
- Worker jobs – clips are generated via `CLIP_RENDER` jobs

**Recovery Priority:** **HIGH** – Restore within 4 hours

---

### 2.3 Jobs & Job Events

**Tables:** `jobs`, `job_events`

**Why Critical:**
- Tracks all background processing (transcribe, render, publish)
- Job events provide audit trail and debugging info
- Worker relies on `jobs` table for claiming and processing work

**Impact of Loss:**
- **Jobs:** Cannot track processing status, may re-process or skip work
- **Job Events:** Lose audit trail, harder to debug issues
- **Worker:** May claim jobs that don't exist or miss jobs that need processing

**External Dependencies:**
- Worker process (reads from `jobs` table)
- RPC functions (`worker_claim_next_job`, `worker_heartbeat`, `worker_finish`)

**Recovery Priority:** **MEDIUM** – Can be regenerated, but restore for audit trail

**Note:** Jobs can be re-queued if lost, but job_events provide valuable debugging info.

---

### 2.4 Connected Accounts & Publishing

**Tables:** `connected_accounts`, `schedules`, `variants` (if using experiments), `performance_snapshots`

**Why Critical:**
- OAuth tokens for TikTok and YouTube (encrypted in `connected_accounts`)
- Publishing schedules and variant experiments
- Performance tracking for published content

**Impact of Loss:**
- **Connected Accounts:** Users cannot publish, must re-authenticate OAuth
- **Schedules:** Scheduled publishes stop working
- **Variants/Experiments:** Lose A/B test data and performance metrics

**External Dependencies:**
- TikTok OAuth API (tokens stored encrypted in DB)
- YouTube OAuth API (tokens stored encrypted in DB)
- Published content on platforms (cannot be recovered from DB)

**Recovery Priority:** **HIGH** – Users must re-authenticate if lost, but schedules can be recreated

**Note:** OAuth tokens cannot be recovered from backups if encryption key changed. Users must reconnect accounts.

---

### 2.5 Billing & Subscriptions

**Tables:** `subscriptions`, `workspace_usage`, `rate_limits`, `idempotency`

**Why Critical:**
- Subscription status determines plan features and limits
- Usage tracking enforces plan limits
- Rate limits prevent abuse
- Idempotency prevents duplicate charges

**Impact of Loss:**
- **Subscriptions:** Users lose plan features, billing breaks
- **Workspace Usage:** Cannot enforce limits, may allow overages
- **Rate Limits:** Abuse protection disabled
- **Idempotency:** Risk of duplicate charges or operations

**External Dependencies:**
- Stripe (source of truth for subscriptions)
- Stripe webhooks (sync subscription status to DB)

**Recovery Priority:** **CRITICAL** – Can re-sync from Stripe, but restore for consistency

**Note:** `subscriptions` table can be rebuilt from Stripe webhook events, but restore is faster.

---

## 3. Backup Strategy (Supabase)

### 3.1 Automated Backups

Supabase provides automated daily backups for all projects. Backups are stored for a configurable retention period.

**How It Works:**
- Supabase takes point-in-time snapshots daily
- Backups are stored in Supabase's infrastructure
- You can restore to any backup point within retention period
- Backups include full database schema and data

**Configuration:**
- **Location:** Supabase Dashboard → Settings → Database → Backups
- **Retention:** Configurable (7, 14, or 30 days recommended)
- **Frequency:** Daily (automatic)

### 3.2 Backup Checklist

- [ ] **Verify Automated Backups Are Enabled**
  - [ ] Go to Supabase Dashboard → Settings → Database
  - [ ] Confirm "Automated Backups" is enabled
  - [ ] Note backup retention period (e.g., 7 days, 14 days, 30 days)

- [ ] **Verify Backup Retention Period**
  - [ ] Check retention setting matches your RPO requirements
  - [ ] **Recommended:** 14-30 days for production
  - [ ] **Note:** Longer retention = more restore points but higher cost

- [ ] **Test Backup Access**
  - [ ] Go to Supabase Dashboard → Database → Backups
  - [ ] Verify you can see recent backup snapshots
  - [ ] Note the restore process (see Section 5.1)

### 3.3 Manual Backups

Take manual backups before major changes or risky operations.

**When to Take Manual Backup:**
- [ ] Before deploying major database migrations
- [ ] Before bulk data operations (DELETE, UPDATE on large tables)
- [ ] Before schema changes that might break RLS
- [ ] Before manual SQL operations in production
- [ ] Before upgrading Supabase project or changing regions

**How to Take Manual Backup:**

**Option 1: Supabase Dashboard (Recommended)**
- [ ] Go to Supabase Dashboard → Database → Backups
- [ ] Click "Create Backup" or "Take Snapshot"
- [ ] Wait for backup to complete (usually 1-5 minutes)
- [ ] Note backup timestamp and ID

**Option 2: SQL Export (For Specific Tables)**
- [ ] Use Supabase Dashboard → SQL Editor
- [ ] Export specific tables using `COPY` or `pg_dump`
- [ ] Save SQL file locally or to secure storage
- [ ] **Example:**
  ```sql
  COPY (SELECT * FROM workspaces WHERE id = '<workspace-id>') 
  TO STDOUT WITH CSV HEADER;
  ```

**Option 3: pg_dump (Full Database)**
- [ ] Use Supabase connection string from Dashboard → Settings → Database
- [ ] Run: `pg_dump -h <host> -U postgres -d postgres > backup_$(date +%Y%m%d).sql`
- [ ] Store backup file securely (encrypted, off-site)

---

## 4. Incident Scenarios

### 4.1 Accidental Data Deletion (Single Workspace or Small Scope)

**Example:** Deleted a workspace, projects, or clips for one customer due to:
- Manual SQL error
- Bug in application code
- Accidental admin action

#### Symptoms

- [ ] User reports missing workspace, projects, or clips
- [ ] Database query shows workspace/projects/clips deleted
- [ ] `workspace_members` shows user no longer has access
- [ ] Related data (clips, jobs) may be orphaned or cascade-deleted

#### Immediate Actions

- [ ] **Stop the Bleeding:**
  - [ ] Identify affected workspace ID(s) or user ID(s)
  - [ ] Verify deletion scope (single workspace vs. multiple)
  - [ ] Check if deletion is still in progress (monitor `jobs` table for cascade deletes)
  - [ ] If possible, pause worker to prevent further processing

- [ ] **Freeze Writes (If Needed):**
  - [ ] Consider temporarily disabling affected user's access
  - [ ] Monitor for additional deletions
  - [ ] Document exact time of deletion (check `updated_at` timestamps)

#### Recovery Steps

- [ ] **Identify Restore Point:**
  - [ ] Determine when data was deleted (check audit logs, `updated_at` timestamps)
  - [ ] Find backup snapshot from before deletion time
  - [ ] **Note:** Restore point should be as close as possible to deletion time to minimize data loss

- [ ] **Restore Strategy:**
  - [ ] **Option A: Point-in-Time Restore (If Available)**
    - [ ] Use Supabase point-in-time restore to restore entire DB to pre-deletion state
    - [ ] **Risk:** May overwrite other users' recent changes
    - [ ] **Safer:** Restore to cloned project, then copy specific rows (see Section 5.2)

  - [ ] **Option B: Selective Restore (Recommended)**
    - [ ] Restore backup to a temporary/cloned Supabase project
    - [ ] Export affected workspace data from cloned project
    - [ ] Import into production project (see Section 5.2)
    - [ ] **Benefit:** Does not affect other workspaces

- [ ] **Restore Affected Data:**
  - [ ] Restore `workspaces` row(s) for affected workspace(s)
  - [ ] Restore `workspace_members` rows for affected users
  - [ ] Restore `projects` rows (if deleted)
  - [ ] Restore `clips` rows (if deleted)
  - [ ] Restore `connected_accounts` (if deleted, users must re-authenticate)
  - [ ] **Note:** Follow foreign key order (workspaces → projects → clips)

- [ ] **Verify Foreign Keys:**
  - [ ] Check `projects.workspace_id` references restored workspace
  - [ ] Check `clips.project_id` references restored projects
  - [ ] Check `jobs.workspace_id` references restored workspace
  - [ ] Fix any orphaned references

#### Verification Steps

- [ ] **User Access:**
  - [ ] User can log in and see restored workspace
  - [ ] User can access restored projects and clips
  - [ ] Workspace members have correct roles

- [ ] **Data Integrity:**
  - [ ] Projects load correctly in UI
  - [ ] Clips display correctly
  - [ ] No orphaned records (check foreign keys)

- [ ] **Functionality:**
  - [ ] User can create new projects (verify workspace is active)
  - [ ] User can generate clips from restored projects
  - [ ] Publishing works (if connected accounts restored)

#### Post-Incident Follow-ups

- [ ] **Root Cause Analysis:**
  - [ ] Identify how deletion occurred (bug, manual SQL, admin action)
  - [ ] Document prevention measures (e.g., add confirmation dialogs, audit logs)

- [ ] **Communication:**
  - [ ] Notify affected user(s) of recovery
  - [ ] Apologize for inconvenience
  - [ ] Explain what was restored and any data loss window

- [ ] **Prevention:**
  - [ ] Add safeguards to prevent accidental deletions
  - [ ] Implement soft deletes for critical tables (add `deleted_at` column)
  - [ ] Add audit logging for destructive operations

---

### 4.2 Bad Migration / Schema Change

**Example:** Deployed a migration that:
- Broke RLS policies (users cannot access their data)
- Deleted required columns (application errors)
- Corrupted data types (invalid values)
- Broke RPC functions (`worker_claim_next_job` fails)

#### Symptoms

- [ ] Application errors after migration deployment
- [ ] Users report "access denied" or "not found" errors
- [ ] Worker cannot claim jobs (RPC function errors)
- [ ] API routes return 500 errors
- [ ] Sentry shows database constraint violations

#### Immediate Actions

- [ ] **Stop the Bleeding:**
  - [ ] **Rollback Migration (If Possible):**
    - [ ] Identify the problematic migration file
    - [ ] Check if migration has a rollback script
    - [ ] Run rollback migration if available
    - [ ] **Note:** Not all migrations are reversible

  - [ ] **Freeze Writes:**
    - [ ] Consider temporarily disabling API writes (return 503 Maintenance)
    - [ ] Pause worker to prevent job processing errors
    - [ ] Document exact time migration was applied

#### Recovery Steps

- [ ] **Assess Damage:**
  - [ ] Check which tables/columns were affected
  - [ ] Verify RLS policies are still active and correct
  - [ ] Test RPC functions manually:
    ```sql
    SELECT * FROM worker_claim_next_job('test-worker');
    SELECT * FROM worker_heartbeat('test-worker', 'test-job');
    ```

- [ ] **Recovery Strategy:**
  - [ ] **Option A: Rollback Migration**
    - [ ] If migration has rollback, apply it
    - [ ] Verify schema matches pre-migration state
    - [ ] Re-run tests: `pnpm test`

  - [ ] **Option B: Restore Schema from Backup**
    - [ ] Restore backup to cloned project
    - [ ] Export schema (DDL only): `pg_dump --schema-only`
    - [ ] Compare with production schema
    - [ ] Apply missing/incorrect schema changes manually
    - [ ] **Risk:** May lose recent data if schema changed significantly

  - [ ] **Option C: Fix in Place (If Minor)**
    - [ ] If only RLS policies broken, fix policies directly
    - [ ] If only RPC functions broken, recreate functions
    - [ ] Verify fixes with tests

- [ ] **Fix RLS Policies:**
  - [ ] Review `db/rls.sql` or migration files for correct policies
  - [ ] Re-apply RLS policies:
    ```sql
    -- Example: Re-apply workspace member read policy
    DROP POLICY IF EXISTS "workspace_members_member_read" ON workspace_members;
    CREATE POLICY "workspace_members_member_read"
      ON workspace_members FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM workspace_members wm_self
          WHERE wm_self.workspace_id = workspace_members.workspace_id
            AND wm_self.user_id = auth.uid()
        )
      );
    ```

- [ ] **Fix RPC Functions:**
  - [ ] Review migration files for RPC definitions
  - [ ] Re-create broken RPCs:
    ```sql
    -- Example: Re-create worker_claim_next_job
    CREATE OR REPLACE FUNCTION worker_claim_next_job(p_worker_id text)
    RETURNS jobs AS $$
    -- ... (see supabase/migrations/*_worker_*.sql)
    $$ LANGUAGE plpgsql;
    ```

- [ ] **Validate Schema:**
  - [ ] Run `pnpm test` to verify database operations work
  - [ ] Test critical paths:
    - [ ] User login and workspace access
    - [ ] Project creation and listing
    - [ ] Job claiming and processing
    - [ ] Publishing workflows

#### Verification Steps

- [ ] **RLS Policies:**
  - [ ] Test as regular user: Can access own workspace
  - [ ] Test as different user: Cannot access other workspaces
  - [ ] Test as service role: Can bypass RLS (for worker/admin)

- [ ] **RPC Functions:**
  - [ ] Test `worker_claim_next_job`: Returns available job
  - [ ] Test `worker_heartbeat`: Updates job heartbeat
  - [ ] Test `worker_finish`: Marks job as completed
  - [ ] Test `worker_reclaim_stale`: Reclaims stuck jobs

- [ ] **Application Functionality:**
  - [ ] Users can log in and access workspaces
  - [ ] Projects and clips load correctly
  - [ ] Worker can process jobs
  - [ ] Publishing works (TikTok/YouTube)

- [ ] **Test Suite:**
  - [ ] Run `pnpm test` and verify all tests pass
  - [ ] Focus on: `test/worker/jobs.*.test.ts`, `test/api/*.test.ts`

#### Post-Incident Follow-ups

- [ ] **Root Cause:**
  - [ ] Review migration file for errors
  - [ ] Check if migration was tested in staging
  - [ ] Document what went wrong

- [ ] **Process Improvement:**
  - [ ] Require all migrations to be tested in staging first
  - [ ] Add migration rollback scripts for critical changes
  - [ ] Add pre-migration validation (backup, test RLS, etc.)

- [ ] **Communication:**
  - [ ] Notify users if downtime occurred
  - [ ] Post-mortem for team (if applicable)

---

### 4.3 Large-Scale Data Corruption

**Example:** Many rows corrupted or incorrect due to:
- Bug in application code (bad UPDATE query)
- Manual SQL error (UPDATE without WHERE clause)
- Data type mismatch or constraint violation
- RLS policy allowing incorrect access

#### Symptoms

- [ ] Multiple users report incorrect data
- [ ] Database queries return unexpected results
- [ ] Application shows wrong data to users
- [ ] Sentry shows data validation errors
- [ ] Billing/subscription data mismatches Stripe

#### Immediate Actions

- [ ] **Stop the Bleeding:**
  - [ ] Identify scope of corruption (which tables, how many rows)
  - [ ] Determine when corruption occurred (check `updated_at` timestamps, audit logs)
  - [ ] Estimate data loss window (time between last good backup and corruption)

- [ ] **Freeze Writes:**
  - [ ] Consider temporarily disabling writes to affected tables
  - [ ] Pause worker to prevent processing corrupted data
  - [ ] Document corruption scope and timeline

#### Recovery Steps

- [ ] **Assess Damage:**
  - [ ] Query affected tables to estimate corruption scope
  - [ ] Identify which workspaces/users are affected
  - [ ] Check if corruption is spreading (cascade effects)

- [ ] **Recovery Decision:**
  - [ ] **Option A: Full Database Restore (If Widespread)**
    - [ ] If >50% of data is corrupted or corruption is spreading
    - [ ] Restore entire database to last known good backup
    - [ ] **Risk:** Loses all data created after backup
    - [ ] **Benefit:** Clean slate, no partial corruption

  - [ ] **Option B: Selective Restore (If Localized)**
    - [ ] If corruption is limited to specific tables/workspaces
    - [ ] Restore only affected tables/rows from backup
    - [ ] **Risk:** May miss related corruption
    - [ ] **Benefit:** Preserves recent data in unaffected areas

  - [ ] **Option C: Patch in Place (If Minor)**
    - [ ] If corruption is small and can be fixed with SQL
    - [ ] Write SQL to correct corrupted values
    - [ ] **Risk:** May miss edge cases
    - [ ] **Benefit:** Fastest recovery, no data loss

- [ ] **Execute Recovery:**
  - [ ] Follow Section 5.1 (Full DB Restore) or Section 5.2 (Selective Restore)
  - [ ] Verify restored data is correct
  - [ ] Re-sync external data if needed (Stripe subscriptions, etc.)

- [ ] **Re-sync External Data:**
  - [ ] **Stripe:** Re-process webhook events or query Stripe API to sync subscriptions
  - [ ] **TikTok/YouTube:** Cannot re-sync published content, but OAuth tokens can be re-authenticated

#### Verification Steps

- [ ] **Data Integrity:**
  - [ ] Sample check: Query random workspaces and verify data looks correct
  - [ ] Verify foreign keys are intact (no orphaned records)
  - [ ] Check billing data matches Stripe (sample of workspaces)

- [ ] **User Impact:**
  - [ ] Test with affected user accounts
  - [ ] Verify they can access their data
  - [ ] Verify published content still exists (on platforms)

- [ ] **Application Functionality:**
  - [ ] Run full test suite: `pnpm test`
  - [ ] Test critical user flows (login, create project, publish)
  - [ ] Monitor Sentry for new errors

#### Post-Incident Follow-ups

- [ ] **Root Cause:**
  - [ ] Identify bug or error that caused corruption
  - [ ] Fix bug in codebase
  - [ ] Add safeguards to prevent similar issues

- [ ] **Communication:**
  - [ ] **Internal:** Document incident timeline and recovery steps
  - [ ] **External:** Notify affected users if significant data loss occurred
  - [ ] **Template:** See Section 7.2 for communication templates

- [ ] **Prevention:**
  - [ ] Add data validation before destructive operations
  - [ ] Add confirmation steps for bulk updates
  - [ ] Implement audit logging for all data modifications

---

### 4.4 Supabase Outage

**Example:** Supabase region outage, extended downtime, or service degradation.

#### Symptoms

- [ ] Application returns 503/504 errors
- [ ] Database connection timeouts
- [ ] Users cannot log in
- [ ] Worker cannot process jobs
- [ ] Supabase status page shows incident

#### Immediate Actions

- [ ] **Confirm It's Supabase:**
  - [ ] Check Supabase status page: `https://status.supabase.com`
  - [ ] Check Supabase Dashboard (if accessible)
  - [ ] Verify database connection from local machine
  - [ ] Check Vercel logs for database connection errors

- [ ] **Stop the Bleeding:**
  - [ ] **Show Maintenance Page:**
    - [ ] Update Vercel to show maintenance page (if possible)
    - [ ] Or return 503 from API routes with maintenance message

  - [ ] **Pause Worker:**
    - [ ] Stop worker process to prevent connection errors
    - [ ] Jobs will remain in queue and process once DB is back

  - [ ] **Monitor:**
    - [ ] Watch Supabase status page for updates
    - [ ] Monitor Vercel logs for connection attempts

#### Recovery Steps

- [ ] **Wait for Supabase Recovery:**
  - [ ] Monitor Supabase status page
  - [ ] Wait for Supabase team to resolve outage
  - [ ] **Note:** Usually 15 minutes to 2 hours for regional outages

- [ ] **Verify Database is Back:**
  - [ ] Test database connection from Supabase Dashboard
  - [ ] Run simple query: `SELECT 1;`
  - [ ] Check if recent data is present (verify no data loss)

- [ ] **Verify Critical Functions:**
  - [ ] Test RPC functions: `worker_claim_next_job`, `worker_heartbeat`
  - [ ] Verify RLS policies are active
  - [ ] Check if any jobs were lost (compare job counts before/after)

- [ ] **Re-sync External State:**
  - [ ] **Stripe:** Check for missed webhook events during outage
    - [ ] Review Stripe Dashboard → Webhooks for failed deliveries
    - [ ] Re-process failed webhook events if needed
  - [ ] **Jobs:** Check for stuck jobs (stale heartbeats)
    - [ ] Run `worker_reclaim_stale` RPC to reset stuck jobs
    - [ ] Re-queue any jobs that were lost

#### Verification Steps

- [ ] **Database Connectivity:**
  - [ ] Application can connect to database
  - [ ] Users can log in
  - [ ] API routes respond correctly

- [ ] **Data Integrity:**
  - [ ] Verify no data loss (compare record counts before/after)
  - [ ] Check for orphaned records or broken foreign keys
  - [ ] Verify recent transactions are present

- [ ] **Functionality:**
  - [ ] Users can access workspaces and projects
  - [ ] Worker can claim and process jobs
  - [ ] Publishing works (TikTok/YouTube)
  - [ ] Billing status is correct (sync with Stripe if needed)

- [ ] **Monitoring:**
  - [ ] Check Sentry for new errors
  - [ ] Monitor Vercel logs for database errors
  - [ ] Verify cron jobs are executing

#### Post-Incident Follow-ups

- [ ] **Documentation:**
  - [ ] Document outage duration and impact
  - [ ] Note any data loss or inconsistencies
  - [ ] Update runbook with lessons learned

- [ ] **Communication:**
  - [ ] Notify users if significant downtime occurred
  - [ ] Post status update on status page or social media

- [ ] **Prevention:**
  - [ ] Consider multi-region setup (if Supabase supports it)
  - [ ] Implement database connection pooling and retries
  - [ ] Add circuit breakers for database operations

---

## 5. Concrete Recovery Procedures

### 5.1 Restoring from Supabase Backup (Full DB)

**Use Case:** Full database restore when widespread corruption or data loss occurs.

**⚠️ Warning:** Full restore replaces entire database. Recent data created after backup will be lost.

#### Procedure

- [ ] **Choose Restore Point:**
  - [ ] Go to Supabase Dashboard → Database → Backups
  - [ ] Review available backup snapshots
  - [ ] Select backup from before the incident
  - [ ] **Note:** Choose backup as close as possible to incident time to minimize data loss

- [ ] **Restore Options:**
  - [ ] **Option A: Restore to Production (Destructive)**
    - [ ] **⚠️ This replaces entire production database**
    - [ ] Go to Supabase Dashboard → Database → Backups
    - [ ] Click "Restore" on selected backup
    - [ ] Confirm restore (this cannot be undone)
    - [ ] Wait for restore to complete (usually 10-30 minutes)
    - [ ] **Risk:** Loses all data created after backup

  - [ ] **Option B: Restore to Cloned Project (Safer)**
    - [ ] Create new Supabase project (temporary)
    - [ ] Restore backup to temporary project
    - [ ] Validate data in temporary project
    - [ ] Export specific tables/rows from temporary project
    - [ ] Import into production project (see Section 5.2)
    - [ ] **Benefit:** Can selectively restore data, preserves recent good data

- [ ] **Post-Restore Steps:**
  - [ ] Verify database schema is correct
  - [ ] Test RLS policies and RPC functions
  - [ ] Re-sync external data (Stripe subscriptions, etc.)
  - [ ] Run verification checklist (Section 6)

#### Verification

- [ ] Database is accessible
- [ ] Schema matches expected state
- [ ] RLS policies are active
- [ ] RPC functions work correctly
- [ ] Sample data queries return expected results

---

### 5.2 Restoring Specific Tables / Rows

**Use Case:** Selective restore when only specific data is lost or corrupted.

**⚠️ Warning:** Must respect foreign key constraints. Restore in dependency order.

#### Procedure

- [ ] **Create Cloned Project:**
  - [ ] Create temporary Supabase project
  - [ ] Restore backup to temporary project
  - [ ] Verify data exists in temporary project

- [ ] **Identify Affected Data:**
  - [ ] List workspace IDs, user IDs, or other identifiers for affected data
  - [ ] Query temporary project to verify data exists
  - [ ] Document foreign key dependencies

- [ ] **Restore in Dependency Order:**
  - [ ] **Step 1: Restore Workspaces**
    ```sql
    -- Export from temporary project
    COPY (SELECT * FROM workspaces WHERE id = '<workspace-id>') 
    TO STDOUT WITH CSV HEADER;
    
    -- Import into production (adjust as needed)
    INSERT INTO workspaces (id, name, owner_id, ...)
    VALUES (...)
    ON CONFLICT (id) DO UPDATE SET ...;
    ```

  - [ ] **Step 2: Restore Workspace Members**
    ```sql
    -- Restore after workspaces are restored
    INSERT INTO workspace_members (id, workspace_id, user_id, role, ...)
    SELECT * FROM temporary_project.workspace_members
    WHERE workspace_id = '<workspace-id>'
    ON CONFLICT (id) DO UPDATE SET ...;
    ```

  - [ ] **Step 3: Restore Projects**
    ```sql
    -- Restore after workspaces are restored
    INSERT INTO projects (id, workspace_id, title, ...)
    SELECT * FROM temporary_project.projects
    WHERE workspace_id = '<workspace-id>'
    ON CONFLICT (id) DO UPDATE SET ...;
    ```

  - [ ] **Step 4: Restore Clips**
    ```sql
    -- Restore after projects are restored
    INSERT INTO clips (id, project_id, ...)
    SELECT * FROM temporary_project.clips
    WHERE project_id IN (SELECT id FROM projects WHERE workspace_id = '<workspace-id>')
    ON CONFLICT (id) DO UPDATE SET ...;
    ```

  - [ ] **Step 5: Restore Related Data**
    - [ ] Restore `connected_accounts` (if needed)
    - [ ] Restore `jobs` (if needed, but can be re-queued)
    - [ ] Restore `schedules` (if needed)

- [ ] **Verify Foreign Keys:**
  - [ ] Check all foreign key constraints are satisfied
  - [ ] Fix any orphaned records
  - [ ] Verify cascade deletes didn't remove related data

#### Verification

- [ ] Affected workspace is accessible
- [ ] Projects and clips load correctly
- [ ] No orphaned records
- [ ] Foreign keys are intact

---

### 5.3 Rebuilding Derived Data

**Use Case:** Regenerating data that can be computed from source data.

#### Which Data is Derived

- **Jobs** – Can be re-queued if source data exists (projects, clips)
- **Job Events** – Audit trail, cannot be regenerated (but not critical)
- **Workspace Usage** – Can be recomputed from projects/clips
- **Rate Limits** – Can be reset (tokens refill over time)
- **Idempotency Keys** – Can be cleared (will allow re-processing)

#### Rebuilding Procedures

- [ ] **Re-queue Jobs:**
  - [ ] Identify projects/clips that need processing
  - [ ] Re-enqueue jobs via `/api/jobs/enqueue` or worker logic
  - [ ] **Example:** Re-queue transcription for projects with status 'queued'
    ```sql
    -- Find projects needing transcription
    SELECT id, workspace_id FROM projects 
    WHERE status = 'queued' AND source_type = 'file';
    
    -- Re-enqueue via API or worker
    ```

- [ ] **Recompute Workspace Usage:**
  - [ ] Query projects/clips to compute usage metrics
  - [ ] Update `workspace_usage` table:
    ```sql
    -- Recompute usage for a workspace
    INSERT INTO workspace_usage (workspace_id, period_start, projects_count, clips_count, source_minutes)
    SELECT 
      workspace_id,
      DATE_TRUNC('month', created_at) as period_start,
      COUNT(*) FILTER (WHERE table_name = 'projects') as projects_count,
      COUNT(*) FILTER (WHERE table_name = 'clips') as clips_count,
      SUM(source_minutes) as source_minutes
    FROM (
      SELECT workspace_id, created_at, 'projects' as table_name, source_minutes FROM projects
      UNION ALL
      SELECT workspace_id, created_at, 'clips' as table_name, 0 as source_minutes FROM clips
    ) combined
    WHERE workspace_id = '<workspace-id>'
    GROUP BY workspace_id, period_start
    ON CONFLICT (workspace_id, period_start) DO UPDATE SET
      projects_count = EXCLUDED.projects_count,
      clips_count = EXCLUDED.clips_count,
      source_minutes = EXCLUDED.source_minutes;
    ```

- [ ] **Reset Rate Limits:**
  - [ ] Clear rate limit tokens (they will refill naturally):
    ```sql
    UPDATE rate_limits SET tokens = 0, last_refill = now();
    ```

- [ ] **Clear Idempotency Keys:**
  - [ ] Clear expired or problematic idempotency keys:
    ```sql
    DELETE FROM idempotency WHERE expires_at < now();
    ```

#### Verification

- [ ] Jobs are processing correctly
- [ ] Usage metrics are accurate
- [ ] Rate limits are reset and working
- [ ] No duplicate operations (idempotency working)

---

## 6. Verification Checklist

After any recovery procedure, run through this checklist to ensure everything is working.

### 6.1 Authentication & Access

- [ ] **User Login:**
  - [ ] Test user can log in via Supabase Auth
  - [ ] User can access their workspace(s)
  - [ ] Workspace members have correct roles

- [ ] **Workspace Access:**
  - [ ] User can list workspaces they belong to
  - [ ] User cannot access other users' workspaces
  - [ ] Workspace owner can manage members

### 6.2 Core Functionality

- [ ] **Projects & Clips:**
  - [ ] User can create new projects
  - [ ] Projects load correctly in UI
  - [ ] Clips display correctly
  - [ ] No orphaned clips (all clips reference valid projects)

- [ ] **Job Processing:**
  - [ ] Worker can claim jobs (`worker_claim_next_job` works)
  - [ ] Jobs process successfully
  - [ ] Job status updates correctly
  - [ ] No stuck jobs (check `worker_reclaim_stale`)

### 6.3 Publishing

- [ ] **Connected Accounts:**
  - [ ] User can connect TikTok account (OAuth flow works)
  - [ ] User can connect YouTube account (OAuth flow works)
  - [ ] Tokens are stored and encrypted correctly

- [ ] **Publishing:**
  - [ ] Test publish to TikTok works
  - [ ] Test publish to YouTube works
  - [ ] Published clips appear on platforms
  - [ ] Scheduled publishes execute (test with near-future schedule)

### 6.4 Billing

- [ ] **Subscriptions:**
  - [ ] Workspace plan matches Stripe subscription
  - [ ] Plan features are enabled correctly (scheduling, limits)
  - [ ] Usage limits are enforced

- [ ] **Stripe Sync:**
  - [ ] Test webhook delivery (create test subscription)
  - [ ] Subscription updates sync to database
  - [ ] Billing status endpoint returns correct data

### 6.5 System Health

- [ ] **Health Endpoints:**
  - [ ] `GET /api/readyz` returns 200
  - [ ] `GET /api/admin/readyz` returns 200 (with service role key)
  - [ ] Health check shows all dependencies healthy

- [ ] **Cron Jobs:**
  - [ ] Vercel Cron is executing `/api/cron/scan-schedules`
  - [ ] Scheduled publishes are being processed
  - [ ] Check Vercel Dashboard → Cron Jobs for execution logs

- [ ] **Monitoring:**
  - [ ] No new critical errors in Sentry
  - [ ] Vercel logs show no database errors
  - [ ] Worker is processing jobs successfully

### 6.6 Data Integrity

- [ ] **Foreign Keys:**
  - [ ] All foreign key constraints are satisfied
  - [ ] No orphaned records (projects without workspaces, clips without projects)
  - [ ] Cascade deletes work correctly (if tested)

- [ ] **RLS Policies:**
  - [ ] Users can only access their own workspaces
  - [ ] Service role can bypass RLS (for worker/admin)
  - [ ] RLS policies are active on all tables

- [ ] **RPC Functions:**
  - [ ] `worker_claim_next_job` returns available jobs
  - [ ] `worker_heartbeat` updates job heartbeat
  - [ ] `worker_finish` marks job as completed
  - [ ] `worker_reclaim_stale` reclaims stuck jobs
  - [ ] `increment_workspace_usage` updates usage metrics

---

## 7. Runbook Roles & Communication

### 7.1 Roles

**Who Should Run These Procedures:**
- **Backend Engineer** – Primary responder for database incidents
- **Founder/CTO** – For critical incidents affecting multiple users
- **DevOps Engineer** – For infrastructure-level issues (Supabase outages)

**Who Should Be Notified:**
- **Internal:** Team Slack channel, founder email
- **External:** Affected users (if significant data loss or downtime)

### 7.2 Communication Templates

#### Internal Note Template

```
INCIDENT: [Brief Description]
TIME: [Start time] - [End time]
SCOPE: [Number of users/workspaces affected]
ROOT CAUSE: [What happened]
RECOVERY: [What was done]
DATA LOSS: [Any data loss window]
STATUS: [Resolved / In Progress / Monitoring]
```

#### External Customer Email Template

**Subject:** Important Update About Your Cliply Account

**Body:**

Hi [Customer Name],

We experienced a technical issue on [Date] that affected your Cliply account. We've resolved the issue and restored your data.

**What happened:**
[Brief, non-technical explanation]

**What we did:**
- Restored your workspace and projects
- Verified all your clips are accessible
- Confirmed your account settings are intact

**What you need to do:**
[If applicable: "Please reconnect your TikTok/YouTube account" or "No action needed"]

**Data Recovery:**
We restored your data from a backup taken on [Date/Time]. Any data created between [Time A] and [Time B] may have been lost. [If no data loss: "No data was lost."]

We apologize for any inconvenience. If you have any questions or notice anything missing, please contact us at [support email].

Thank you for your patience.

— Cliply Team

---

## 8. Appendix

### 8.1 Related Documentation

- **Full Readiness Audit:** `REPORTS/full_readiness_audit_2025.md`
  - System overview, feature inventory, critical gaps

- **Production Deployment Checklist:** `REPORTS/production_deployment_checklist_2025.md`
  - Pre-launch setup, environment variables, service configuration

- **Environment Variables:** `ENV.md`
  - Complete list of environment variables and their purposes

### 8.2 Supabase Resources

- **Supabase Dashboard:** `https://supabase.com/dashboard`
- **Supabase Status:** `https://status.supabase.com`
- **Supabase Docs:** `https://supabase.com/docs`
- **Backup & Restore Docs:** `https://supabase.com/docs/guides/platform/backups`

### 8.3 Important Reminders

- **Always test recovery procedures in staging or a cloned project before executing on production.**
- **Take a manual backup before any recovery operation.**
- **Document all recovery steps and decisions for post-incident review.**
- **Verify data integrity after recovery before declaring incident resolved.**

### 8.4 Quick Reference

**Critical Tables (Restore Order):**
1. `workspaces`
2. `workspace_members`
3. `users` (if corrupted)
4. `projects`
5. `clips`
6. `connected_accounts`
7. `schedules`
8. `subscriptions` (or re-sync from Stripe)
9. `jobs` (or re-queue)
10. `workspace_usage` (or recompute)

**Critical RPC Functions:**
- `worker_claim_next_job`
- `worker_heartbeat`
- `worker_finish`
- `worker_reclaim_stale`
- `increment_workspace_usage`

**Health Check Endpoints:**
- `GET /api/readyz` – Public health check
- `GET /api/admin/readyz` – Admin health check (requires service role key)

---

**Last Updated:** 2025-01-XX  
**Maintained By:** Cliply Backend Team

