# RLS Policy Strategy and Service Role Usage

**Document Purpose:** Canonical reference for Row Level Security (RLS) policy patterns, service role usage, and SECURITY DEFINER RPC conventions.

**Last Updated:** 2025-12-14 (based on migrations as of 20251210163500)

---

## Purpose & Scope

### What This Document Covers

- **RLS Posture**: Our workspace-scoped access model using workspace membership
- **Role Usage**: When and why we use `anon`, `authenticated`, and `service_role`
- **Service Role Pattern**: How `service_role` bypasses RLS and when it's appropriate
- **SECURITY DEFINER RPCs**: When and how we use SECURITY DEFINER functions
- **Naming Conventions**: Policy naming patterns (`workspace_member_*` vs `*_service_role_full_access`)
- **Evidence**: Concrete migration references documenting our patterns

### What This Document Does NOT Cover

- Application-level authorization (middleware, route guards)
- Supabase Auth configuration
- Database schema design (table structures)
- Migration execution procedures
- Testing strategies for RLS policies

---

## Roles & Trust Boundaries

### Role Hierarchy

PostgreSQL roles used in our RLS model:

1. **`anon`**: Unauthenticated users
   - Typically has no table access (policies target `authenticated` or `service_role`)

2. **`authenticated`**: Users with valid Supabase auth session
   - Access controlled via workspace membership checks
   - Can read/modify data within their workspace(s)

3. **`service_role`**: Server-side operations only
   - **⚠️ CRITICAL: Must only be used server-side, never exposed to client code**
   - Bypasses RLS via explicit policies
   - Used by:
     - Worker processes (job processing)
     - API endpoints (server-to-database operations)
     - Background tasks and cron jobs

### Trust Boundary Violation Warning

**The `service_role` key must NEVER be:**
- Exposed in client-side JavaScript/TypeScript
- Included in API responses
- Logged in client-accessible logs
- Used in browser extensions or mobile apps

**Consequence:** A compromised service role key grants full database access, bypassing all RLS policies.

---

## Workspace-Scoped Data Model Pattern

### Core Concept

Our data access model centers on **workspace membership**. Most domain tables include a `workspace_id` column, and access is granted to users who are members of that workspace.

### Workspace Membership Check

Membership is tracked in the `workspace_members` table:

```sql
CREATE TABLE workspace_members (
  id uuid PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id),
  user_id uuid NOT NULL,
  role text DEFAULT 'member',
  inserted_at timestamptz DEFAULT now()
);
```

**Helper Function:** `public.is_workspace_member(p_workspace_id uuid)`

- **Defined in:** `supabase/migrations/20251201010000_fix_workspace_membership_helper.sql`
- **Purpose:** Non-recursive membership check using SECURITY DEFINER to avoid RLS recursion
- **Usage:** RLS policies call this function instead of querying `workspace_members` directly

```sql
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  );
$$;
```

### Common Access Pattern

**For most workspace-scoped tables:**

1. **Read Access**: Members can read data within their workspace(s)
   - Policy: `USING (public.is_workspace_member(workspace_id))`

2. **Write Access**: Often restricted to specific operations or requires additional checks
   - Some tables: Full write access for members (e.g., `experiments`, `products`)
   - Other tables: Write restricted (e.g., `jobs` - no user writes, only service role)

3. **Service Role**: Full access to all workspaces for system operations

---

## Policy Patterns & Naming Conventions

### Pattern 1: Workspace Member Access

**Naming:** `{table}_workspace_member_{operation}` or `{table}_workspace_member_access`

**Examples:**
- `workspace_usage_workspace_member_read` (SELECT only)
- `experiments_workspace_member_access` (ALL operations)
- `jobs_workspace_member_select` (SELECT only)

**Template:**
```sql
CREATE POLICY "{table}_workspace_member_{operation}"
  ON public.{table}
  FOR {operation}
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
```

**Evidence:**
- `supabase/migrations/20251123000000_workspace_usage.sql` (see migration file; grep for `workspace_usage_workspace_member_read`)
- `supabase/migrations/20251123021611_viral_experiments.sql` (see migration file; grep for `experiments_workspace_member_access`)
- `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for `jobs_workspace_member_select`)

### Pattern 2: Service Role Full Access

**Naming:** `{table}_service_role_full_access`

**Examples:**
- `jobs_service_role_full_access`
- `workspace_usage_service_role_full_access`
- `connected_accounts_service_role_full_access`

**Template:**
```sql
CREATE POLICY "{table}_service_role_full_access"
  ON public.{table}
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

**Universal Pattern (Auto-Applied):**

Migration `20250101000007_rls_service_role_full_access.sql` creates `service_role_full_access_{table}` policies for all existing tables via dynamic SQL:

```sql
-- Builds policy name: service_role_full_access_{tablename}
CREATE POLICY {policy_name}
  ON public.{tablename}
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

**Note:** Some tables also create explicit named policies (e.g., `jobs_service_role_full_access`) for clarity, even though the universal pattern applies.

**Evidence:**
- `supabase/migrations/20250101000007_rls_service_role_full_access.sql` (see migration file; grep for `service_role_full_access`)
- `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for `jobs_service_role_full_access`)
- `supabase/migrations/20251123000000_workspace_usage.sql` (see migration file; grep for `workspace_usage_service_role_full_access`)

### Policy Iteration History (Jobs Table)

The `jobs` table policies went through multiple iterations before stabilization:

1. **Initial policies** (20250101000004): Used `workspace_id()` JWT helper
2. **Owner check iterations** (20251022001000 - 20251022004000): Multiple attempts using `workspaces.owner_id` or `workspace_members`
3. **Remote schema** (20251020043717): Added `jobs_all` using `workspaces.owner_id OR user_has_org_link`
4. **Stabilization** (20251210163500): Consolidated to minimal policy set

**Current State:** See "Jobs Table Specific Strategy" below.

**Evidence:**
- `supabase/migrations/20250101000004_rls_jobs_policies.sql`
- `supabase/migrations/20251022003000_rls_jobs_policy_minimal.sql`
- `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for "Epic 6" comment at start)

---

## Jobs Table Specific Strategy

### Minimal Policies Intent

The jobs table uses a **minimal policy set** designed for worker/system operations:

1. **Service role full access**: Worker operations and API endpoints
2. **Workspace member read**: Users can read jobs for their workspace (if needed)
3. **No user writes**: Users cannot INSERT/UPDATE/DELETE jobs directly

### Current Policies

**Policy 1: Service Role Full Access**

```sql
CREATE POLICY "jobs_service_role_full_access"
  ON public.jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

**Purpose:** Worker processes and API endpoints use service-role key to manage jobs.

**Evidence:** `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for `jobs_service_role_full_access`)

**Policy 2: Workspace Member Select**

```sql
CREATE POLICY "jobs_workspace_member_select"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
  );
```

**Purpose:** Allows workspace members to read jobs for their workspace (if user-facing reads exist).

**Note:** Uses `is_workspace_member()` helper to avoid RLS recursion (previously caused issues).

**Evidence:** `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for `jobs_workspace_member_select`)

**Migration Comments:**

> "Epic 6: Stabilize jobs table RLS policies
> This migration consolidates all previous jobs RLS policy iterations into a clear, minimal set.
> Design:
>   - Service-role: Full access (for worker operations and API endpoints)
>   - Authenticated users: Workspace-scoped SELECT only (for user-facing reads if any)
>   - No INSERT/UPDATE/DELETE for authenticated users (only service role can modify jobs)"

**Evidence:** `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (see migration file; grep for "Epic 6" comment at start)

---

## SECURITY DEFINER RPCs

### When SECURITY DEFINER Is Acceptable

**SECURITY DEFINER** functions run with the privileges of the function owner (typically `postgres` or `supabase_admin`), bypassing RLS. Use this pattern only when:

1. **Avoiding RLS Recursion**: Functions that query RLS-protected tables (e.g., `workspace_members`) from within RLS policies
2. **Worker Operations**: RPCs called by worker processes that need full access
3. **System Operations**: Background tasks, migrations, or maintenance functions

### Principle of Least Privilege

Even with SECURITY DEFINER, control access via:

1. **GRANT EXECUTE**: Only grant to roles that need it (when explicitly needed)

2. **SET search_path**: Prevent schema injection
   ```sql
   CREATE FUNCTION ...
   SET search_path = public
   ```

3. **Parameter Validation**: Validate inputs within the function

### Worker/Job RPC Pattern

Worker RPCs use SECURITY DEFINER to access the `jobs` table without RLS restrictions:

**Example: `worker_claim_next_job`**

```sql
CREATE OR REPLACE FUNCTION public.worker_claim_next_job(p_worker_id text)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Select and update jobs without RLS restrictions
  ...
$$;
```

**Evidence:** `supabase/migrations/20250101000006_worker_claim_next_job_rpc.sql` (confirmed: SECURITY DEFINER, SET search_path = public)

**Note:** No explicit GRANT EXECUTE for `worker_claim_next_job` was found in migrations during repo grep; execution may rely on default function privileges unless revoked—verify in DB ACLs if hardening requires explicit grants.

**Other Worker RPCs:**

- `worker_fail`: Handles job failures and dead letter queue transitions
  - Evidence: `supabase/migrations/20251208060001_add_worker_fail_rpc.sql` (see migration file; grep for `SECURITY DEFINER`)

- `worker_heartbeat`: Updates heartbeat timestamp for running jobs
  - Evidence: `supabase/migrations/20251208061000_add_worker_heartbeat_and_stuck_recovery.sql` (see migration file; grep for `worker_heartbeat` and `SECURITY DEFINER`)

- `worker_recover_stuck_jobs`: Recovers stale running jobs
  - Evidence: `supabase/migrations/20251208061000_add_worker_heartbeat_and_stuck_recovery.sql` (see migration file; grep for `worker_recover_stuck_jobs` and `SECURITY DEFINER`)

- `worker_finish`: Confirmed in `supabase/migrations/20251107181814_add_worker_finish_and_job_events.sql`: SECURITY INVOKER, and GRANT EXECUTE to anon, authenticated, service_role.

### Membership Helper Pattern

The `is_workspace_member()` function uses SECURITY DEFINER to query `workspace_members` without RLS recursion:

```sql
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO anon;
```

**Evidence:** `supabase/migrations/20251201010000_fix_workspace_membership_helper.sql` (see migration file; grep for `is_workspace_member`)

**Purpose:** Allows RLS policies on other tables to check workspace membership without causing RLS recursion when querying `workspace_members`.

---

## Operational Guidance

### How to Audit/Verify Policies

**1. Query Active Policies:**

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**2. Verify Service Role Policies:**

Look for policies with:
- `policyname LIKE '%service_role_full_access%'`
- `roles` includes `service_role`
- `qual` and `with_check` are `true` or `auth.role() = 'service_role'`

**3. Verify Workspace Member Policies:**

Look for policies with:
- `policyname LIKE '%workspace_member%'`
- `roles` includes `authenticated`
- `qual` uses `is_workspace_member()` or queries `workspace_members`

**4. Check for Missing Policies:**

```sql
SELECT t.tablename
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = t.tablename
      AND c.relrowsecurity = true  -- RLS enabled
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = t.tablename
  );
```

### Change Management Expectations

**New Policy Changes:**

1. **Create migration file**: `supabase/migrations/{timestamp}_{description}.sql`
2. **Include DROP IF EXISTS**: Drop old policies before creating new ones
   ```sql
   DROP POLICY IF EXISTS old_policy_name ON public.table_name;
   ```
3. **Document intent**: Add comments explaining the policy purpose
4. **Test thoroughly**: Verify service-role and authenticated user access patterns

**Examples:**
- Jobs stabilization: `supabase/migrations/20251210163500_jobs_rls_stabilization.sql`
- Membership helper fix: `supabase/migrations/20251201010000_fix_workspace_membership_helper.sql`

**Never:**
- Modify existing migrations (they are immutable history)
- Create policies without considering service-role access
- Use overly broad policies (`USING (true)` for `authenticated`)

---

## Appendix: Evidence Index

### Key Migration Files

This documentation is based on the following migrations (in chronological order):

1. **Workspace Membership Base**
   - `supabase/migrations/20250101000000_rls_workspaces_members.sql`
     - Creates `workspaces` and `workspace_members` tables
     - Initial workspace membership policies

2. **Service Role Full Access Pattern**
   - `supabase/migrations/20250101000007_rls_service_role_full_access.sql`
     - Universal service-role bypass pattern for all tables

3. **Jobs Table RLS Iterations**
   - `supabase/migrations/20250101000004_rls_jobs_policies.sql` (initial)
   - `supabase/migrations/20251022003000_rls_jobs_policy_minimal.sql` (iteration)
   - `supabase/migrations/20251210163500_jobs_rls_stabilization.sql` (stabilized)

4. **Worker RPCs**
   - `supabase/migrations/20250101000006_worker_claim_next_job_rpc.sql` (SECURITY DEFINER)
   - `supabase/migrations/20251107181814_add_worker_finish_and_job_events.sql` (worker_finish)
   - `supabase/migrations/20251208060001_add_worker_fail_rpc.sql` (SECURITY DEFINER)
   - `supabase/migrations/20251208061000_add_worker_heartbeat_and_stuck_recovery.sql` (SECURITY DEFINER)

5. **Workspace Membership Helper Fix**
   - `supabase/migrations/20251201010000_fix_workspace_membership_helper.sql`
     - Creates non-recursive `is_workspace_member()` helper using SECURITY DEFINER
     - Updates policies to use the helper

6. **Workspace-Scoped Table Examples**
   - `supabase/migrations/20251123000000_workspace_usage.sql` (workspace_usage policies)
   - `supabase/migrations/20251123021611_viral_experiments.sql` (experiments policies)
   - `supabase/migrations/20251130000000_dropshipping_actions.sql` (dropshipping_actions policies)

7. **Additional Patterns**
   - `supabase/migrations/20240000000001_workspace_id_helper.sql` (JWT claim helper - older pattern)
   - `supabase/migrations/20250101000005_rls_idempotency_policies.sql` (idempotency uses JWT claim pattern)

### Verification Notes

When verifying details in this document:

- **Check migration file comments**: Many migrations include inline comments explaining design decisions
- **Query `pg_policies`**: For current state, query the database directly (migrations are historical)
- **Review application code**: Service-role usage in `apps/web` and `apps/worker` directories
- **Check for new migrations**: This document reflects state as of `20251210163500`; newer migrations may change patterns

---

**End of Document**
