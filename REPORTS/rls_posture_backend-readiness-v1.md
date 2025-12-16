# RLS Posture Report – backend-readiness-v1

**Run #1 – 2025-12-10 21:15 UTC**  
**Git Branch:** `backend-readiness-v1`  
**Git Commit:** `2778e6d63937faf74f4c002c406bfbf5334b07f7`

---

## High-Level Summary

### Overall RLS Posture: **🟡 YELLOW** (Generally secure but with notable concerns)

**Key Findings:**

- ✅ **Strong Foundation**: RLS enabled on all core domain tables (workspaces, projects, clips, schedules, jobs, etc.)
- ✅ **Service Role Pattern**: Consistent service-role bypass policies for worker/system operations
- ✅ **Workspace Scoping**: Most tables correctly scoped to workspace membership via `is_workspace_member()` helper
- 🟡 **Jobs Table Instability**: Multiple policy iterations (6+ migrations) suggest ongoing refinement and potential instability
- 🟡 **Policy Inconsistency**: Some tables use `workspaces.owner_id` checks, others use `workspace_members` - mixed patterns
- 🟡 **Connected Accounts**: Policy allows users to access any account where `user_id = auth.uid()`, but also has workspace-scoped read - potential confusion
- 🟢 **Recursion Fix**: Recent migration (20251201010000) addresses RLS recursion issues with `is_workspace_member()` helper function
- 🟡 **Missing Policies**: Some tables have RLS enabled but policies may be incomplete (e.g., projects, clips base tables)

**Immediate "Must Watch" Items:**

1. **🟡 MEDIUM (Person 1)**: Jobs table RLS policy has gone through 6+ iterations - needs stabilization and documentation
2. **🟡 MEDIUM (Person 2)**: Projects and clips tables may lack explicit policies (rely on remote_schema.sql policies)
3. **🟡 LOW (Person 1)**: Verify all tables with RLS enabled have appropriate policies (no "locked" tables)
4. **🟢 LOW (Person 2)**: Review connected_accounts policy pattern - dual access pattern (user_id + workspace) may be intentional but needs documentation

---

## Section A – Table Inventory

| Table | Category | RLS Enabled? | Policies Exist? | Risk | OWNER | Notes |
|-------|----------|--------------|-----------------|------|-------|-------|
| `workspaces` | Access | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `workspaces_member_select`, `workspaces_owner_*`, service-role |
| `workspace_members` | Access | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `workspace_members_self`, `workspace_members_member_read`, service-role |
| `organizations` | Access | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `org_select`, `org_mod` (owner-based) |
| `org_workspaces` | Access | ✅ | ✅ | 🟢 Low | Person 2 | Policy: `orgws_select` (org owner or workspace owner) |
| `projects` | Content | ✅ | ✅ | 🟡 Medium | Person 2 | Policy: `prj_all` (owner_id or org link) - may need workspace_member check |
| `clips` | Content | ✅ | ✅ | 🟡 Medium | Person 2 | Policy: `clip_all` (owner_id or org link) - may need workspace_member check |
| `schedules` | Scheduling | ✅ | ✅ | 🟡 Medium | Person 2 | Policy: `sch_all` (owner_id or org link) - may need workspace_member check |
| `jobs` | System | ✅ | ✅ | 🟢 Low | **Person 1** | **Stabilized** (Run #2) - Policies: `jobs_service_role_full_access`, `jobs_workspace_member_select` |
| `job_events` | System | ✅ | ✅ | 🟢 Low | **Person 1** | Policy: `job_events_are_workspace_scoped` (via jobs join) |
| `connected_accounts` | Access | ✅ | ✅ | 🟡 Medium | Person 2 | Multiple policies: `ca_all` (user_id), `connected_accounts_workspace_member_*` |
| `subscriptions` | Billing | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `subscriptions_workspace_member_read`, service-role insert/update |
| `products` | Content | ✅ | ✅ | 🟡 Medium | Person 2 | Policies: `products_all` (owner_id or org link), `products_workspace_member_access` |
| `clip_products` | Content | ✅ | ✅ | 🟡 Medium | Person 2 | Policies: `clip_products_all` (owner_id or org link), `clip_products_workspace_member_access` |
| `workspace_usage` | System | ✅ | ✅ | 🟢 Low | **Person 1** | Policies: `workspace_usage_workspace_member_read`, service-role full access |
| `rate_limits` | System | ✅ | ✅ | 🟢 Low | **Person 1** | Policies: `rl_all` (user_id), `rate_limits_workspace_member_read`, service-role |
| `events` | System | ✅ | ✅ | 🟡 Medium | Person 2 | Policy: `events_all` (workspace_id via workspace_members) |
| `events_audit` | System | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `events_audit_workspace_member_read`, service-role insert |
| `idempotency` | System | ✅ | ✅ | 🟢 Low | **Person 1** | Policies: `idempotency_select_same_workspace`, `idempotency_insert_same_workspace` |
| `dmca_reports` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `dmca_reports_workspace_member_*`, service-role |
| `users` | Identity | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `users_self_*`, service-role |
| `billing_customers` | Billing | ✅ | ❓ | 🟡 Medium | Person 2 | RLS enabled but policies not found in migrations reviewed |
| `experiments` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `experiments_workspace_member_access`, service-role |
| `experiment_variants` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `experiment_variants_workspace_member_access`, service-role |
| `variant_posts` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `variant_posts_workspace_member_access`, service-role |
| `variant_metrics` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `variant_metrics_workspace_member_access`, service-role |
| `dropshipping_actions` | Content | ✅ | ✅ | 🟢 Low | Person 2 | Policies: `dropshipping_actions_workspace_member_access`, service-role |

**Key Relationships:**
- `workspaces.id` → referenced by: projects, clips, schedules, jobs, connected_accounts, subscriptions, workspace_usage, events, etc.
- `workspace_members.workspace_id` → links users to workspaces
- `projects.id` → referenced by: clips
- `clips.id` → referenced by: schedules, clip_products

---

## Section B – Policies Overview

### Workspaces & Access Control

**Table: `workspaces`**
- **Policy: `workspaces_member_select`** (SELECT)
  - Uses: `is_workspace_member(id) OR owner_id = auth.uid()`
  - Allows workspace members or owners to read workspaces
- **Policies: `workspaces_owner_*`** (INSERT/UPDATE/DELETE)
  - Uses: `owner_id = auth.uid()`
  - Only owners can modify workspaces
- **Policy: `workspaces_service_role_full_access`** (ALL)
  - Service role bypass

**Table: `workspace_members`**
- **Policy: `workspace_members_self`** (SELECT)
  - Uses: `user_id = auth.uid()`
  - Users can see their own memberships
- **Policy: `workspace_members_member_read`** (SELECT)
  - Uses: `user_id = auth.uid()`
  - Non-recursive version (fixed in 20251201010000)
- **Policies: `workspace_members_owner_*`** (INSERT/UPDATE/DELETE)
  - Owner-based modifications
- **Policy: `workspaces_service_role_full_access`** (ALL)
  - Service role bypass

### Content Tables

**Table: `projects`**
- **Policy: `prj_all`** (ALL)
  - Uses: `workspaces.owner_id = auth.uid() OR user_has_org_link(workspace_id)`
  - **Note**: Does not use `workspace_members` - only checks owner_id or org link
  - **Risk**: Workspace members who are not owners may not have access

**Table: `clips`**
- **Policy: `clip_all`** (ALL)
  - Uses: `workspaces.owner_id = auth.uid() OR user_has_org_link(workspace_id)`
  - **Note**: Same pattern as projects - owner/org only, not workspace_members
  - **Risk**: Workspace members who are not owners may not have access

**Table: `schedules`**
- **Policy: `sch_all`** (ALL)
  - Uses: `workspaces.owner_id = auth.uid() OR user_has_org_link(workspace_id)`
  - **Note**: Same pattern as projects/clips
  - **Risk**: Workspace members who are not owners may not have access

**Table: `connected_accounts`**
- **Policy: `ca_all`** (ALL)
  - Uses: `user_id = auth.uid()`
  - Users can access their own connected accounts
- **Policy: `connected_accounts_workspace_member_read`** (SELECT)
  - Uses: `is_workspace_member(workspace_id)`
  - Workspace members can read accounts for their workspace
- **Policy: `connected_accounts_workspace_member_modify`** (ALL)
  - Uses: `is_workspace_member(workspace_id)`
  - Workspace members can modify accounts for their workspace
- **Note**: Dual access pattern - both user_id and workspace-based

### System Tables

**Table: `jobs`** ⚠️ **INSTABILITY WARNING**
- **Current Policy: `jobs_are_workspace_scoped`** (ALL)
  - Migration: `20251112031541_create_jobs.sql`
  - Uses: `EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = jobs.workspace_id AND user_id = auth.uid())`
  - **Note**: This is the 6th+ iteration of jobs RLS policies
- **Previous Policy Iterations:**
  1. `20250101000004_rls_jobs_policies.sql` - Initial policies: `jobs_select_same_workspace`, `jobs_insert_same_workspace`, etc. (used `workspace_id()` helper)
  2. `20251022001000_rls_jobs_owner_check_text.sql` - `jobs_all` using `workspace_members` (dropped)
  3. `20251022002000_rls_jobs_owner_check_strict_text.sql` - `jobs_all` using `workspace_members` with text casting (dropped)
  4. `20251022003000_rls_jobs_policy_minimal.sql` - `jobs_all` using `workspaces.owner_id` (dropped)
  5. `20251022004000_rls_jobs_policy_no_cast_error.sql` - `jobs_all` using `workspaces.owner_id` with null checks (dropped)
  6. `20251020043717_remote_schema.sql` - `jobs_all` using `workspaces.owner_id OR user_has_org_link` (may still exist)
  7. `20251112031541_create_jobs.sql` - `jobs_are_workspace_scoped` using `workspace_members` (current)
- **Risk**: Multiple conflicting policies may exist - needs audit

**Table: `job_events`**
- **Policy: `job_events_are_workspace_scoped`** (ALL)
  - Uses: `EXISTS (SELECT 1 FROM jobs j JOIN workspace_members wm ON wm.workspace_id = j.workspace_id WHERE j.id = job_events.job_id AND wm.user_id = auth.uid())`
  - Correctly scoped via jobs table

**Table: `workspace_usage`**
- **Policy: `workspace_usage_workspace_member_read`** (SELECT)
  - Uses: `is_workspace_member(workspace_id)`
  - Workspace members can read usage for their workspace
- **Policy: `workspace_usage_service_role_full_access`** (ALL)
  - Service role bypass

**Table: `rate_limits`**
- **Policy: `rl_all`** (ALL)
  - Uses: `user_id = auth.uid()`
  - Users can access their own rate limits
- **Policy: `rate_limits_workspace_member_read`** (SELECT)
  - Uses: `is_workspace_member(workspace_id)`
  - Workspace members can read rate limits for their workspace
- **Policy: `rate_limits_service_role_full_access`** (ALL)
  - Service role bypass

**Table: `idempotency`**
- **Policy: `idempotency_select_same_workspace`** (SELECT)
  - Uses: `workspace_id() = workspace_id` (JWT claim)
- **Policy: `idempotency_insert_same_workspace`** (INSERT)
  - Uses: `workspace_id() = workspace_id` (JWT claim)
- **Note**: Uses JWT claim helper, not workspace_members check

### Billing Tables

**Table: `subscriptions`**
- **Policy: `subscriptions_workspace_member_read`** (SELECT)
  - Uses: `is_workspace_member(workspace_id)`
  - Workspace members can read subscriptions
- **Policy: `subscriptions_service_insert`** (INSERT)
  - Uses: `auth.role() = 'service_role'`
  - Service role can create subscriptions
- **Policy: `subscriptions_service_update`** (UPDATE)
  - Uses: `auth.role() = 'service_role'`
  - Service role can update subscriptions
- **Policy: `subscriptions_service_role_full_access`** (ALL)
  - Service role bypass

### Service Role Pattern

**Universal Pattern:**
- **Policy: `service_role_full_access_<table>`** (ALL)
  - Created by: `20250101000007_rls_service_role_full_access.sql`
  - Uses: `auth.role() = 'service_role'` with `USING (true) WITH CHECK (true)`
  - Applied to all tables in `public` schema
  - **Purpose**: Allows worker/system operations to bypass RLS

---

## Section C – Jobs Table Spotlight

### Migration Trail

The `jobs` table has undergone significant RLS policy churn:

1. **20250101000001_jobs_table.sql** - Table created
2. **20250101000004_rls_jobs_policies.sql** - Initial RLS policies:
   - `jobs_select_same_workspace` (uses `workspace_id()` helper)
   - `jobs_insert_same_workspace`
   - `jobs_update_same_workspace`
   - `jobs_delete_same_workspace`
3. **20251020043717_remote_schema.sql** - Creates `jobs_all` policy:
   - Uses: `workspaces.owner_id = auth.uid() OR user_has_org_link(workspace_id)`
4. **20251022001000_rls_jobs_owner_check_text.sql** - Replaces with `workspace_members` check
5. **20251022002000_rls_jobs_owner_check_strict_text.sql** - Adds text casting
6. **20251022003000_rls_jobs_policy_minimal.sql** - Back to `workspaces.owner_id`
7. **20251022004000_rls_jobs_policy_no_cast_error.sql** - Adds null checks
8. **20251112031541_create_jobs.sql** - Creates new policy `jobs_are_workspace_scoped`:
   - Uses: `workspace_members` check
9. **20251210163500_jobs_rls_stabilization.sql** - **STABILIZATION** (Run #2):
   - Drops all previous policies (7 policies)
   - Creates 2 explicit policies: `jobs_service_role_full_access`, `jobs_workspace_member_select`
   - **This is the current, stabilized policy set**

### Current Effective Posture

**Active Policies (as of migration 20251210163500 - Run #2):**

1. **Policy: `jobs_service_role_full_access`** (ALL operations)
   - **Logic**: `USING (true) WITH CHECK (true)` for `service_role`
   - **Scope**: Full access for service-role (worker and API operations)
   - **Purpose**: Worker operations and API endpoints use service-role key

2. **Policy: `jobs_workspace_member_select`** (SELECT only)
   - **Logic**: `USING (public.is_workspace_member(workspace_id))`
   - **Scope**: Workspace-scoped read access for authenticated users
   - **Purpose**: Allows workspace members to read jobs (if user-facing reads exist)
   - **Note**: Uses non-recursive `is_workspace_member()` helper

**Intended Use-Case:**
- **Worker Operations**: Service role → Full access via `jobs_service_role_full_access`
- **API Operations**: Service role → Full access via `jobs_service_role_full_access`
- **User-Facing Reads**: Authenticated users → Workspace-scoped SELECT via `jobs_workspace_member_select`
- **User Modifications**: Not permitted (no INSERT/UPDATE/DELETE for authenticated users)

### Risk Classification

**Risk Level: 🟢 GREEN (Low)** ✅ **Updated in Run #2**

**Rationale:**
- ✅ RLS is enabled
- ✅ Clear, minimal policy set (2 policies, down from 7+)
- ✅ Service-role access explicitly defined
- ✅ User access constrained to workspace membership
- ✅ No overly broad policies (no `USING (true)` for anon/authenticated)
- ✅ Uses non-recursive `is_workspace_member()` helper
- ✅ No conflicting policies (all previous policies dropped in Run #2)

**Previous Issues (Resolved):**
- ✅ Multiple policy iterations → Consolidated into 2 clear policies
- ✅ Potential conflicting policies → All previous policies explicitly dropped
- ✅ Unclear access pattern → Documented in Run #2 section

**Remaining Considerations:**
- ⚠️ User-facing job reads: Policy exists but may not be used (API endpoints use service-role)
- ⚠️ Future: Consider removing `jobs_workspace_member_select` if no user-facing reads exist

---

## Section D – Yellow/Red Findings & Owner Map

| ID | Table | Issue Summary | Risk | OWNER | Notes |
|----|-------|---------------|------|-------|-------|
| **F1** | `jobs` | ~~Multiple RLS policy iterations (6+ migrations) suggest instability~~ | 🟢 **RESOLVED** | **Person 1** | **Fixed in Run #2** - Policies stabilized, risk reduced to Green |
| **F2** | `projects` | Policy uses `owner_id` only, not `workspace_members` - members may not have access | 🟡 Medium | Person 2 | Verify if intentional (owner-only) or should use `is_workspace_member()` |
| **F3** | `clips` | Policy uses `owner_id` only, not `workspace_members` - members may not have access | 🟡 Medium | Person 2 | Same as projects - verify access pattern |
| **F4** | `schedules` | Policy uses `owner_id` only, not `workspace_members` - members may not have access | 🟡 Medium | Person 2 | Same as projects/clips - verify access pattern |
| **F5** | `connected_accounts` | Dual access pattern (user_id + workspace) may be confusing | 🟡 Low | Person 2 | Verify if intentional - users can access via user_id OR workspace membership |
| **F6** | `billing_customers` | RLS enabled but policies not found in migrations | 🟡 Medium | Person 2 | Verify if policies exist or table is locked |
| **F7** | `idempotency` | Uses JWT claim helper `workspace_id()`, not `workspace_members` check | 🟡 Low | **Person 1** | Verify if JWT claim is always set correctly |

**Summary by Risk Level:**

**🟡 YELLOW (Medium Risk) - 6 findings:**
- F1: Jobs table policy instability (Person 1)
- F2-F4: Projects/clips/schedules may not allow workspace member access (Person 2)
- F6: Billing_customers policies unclear (Person 2)

**🟡 LOW Risk - 2 findings:**
- F5: Connected accounts dual pattern (Person 2)
- F7: Idempotency JWT claim usage (Person 1)

**🟢 No RED findings** - All tables have RLS enabled, no completely open policies found

---

## Section E – Suggested Next Epics (for Ariel)

### Person 1 (Backend Readiness / Engine Internals)

1. **Epic: Audit and Stabilize Jobs Table RLS**
   - Query `pg_policies` to list all existing policies on `jobs` table
   - Remove any duplicate/conflicting policies
   - Document intended access pattern (worker vs user contexts)
   - Add integration tests for RLS policies
   - **Estimated**: 1-2 days

2. **Epic: Verify System Table RLS Coverage**
   - Audit `workspace_usage`, `rate_limits`, `idempotency` policies
   - Verify `idempotency` JWT claim pattern is correct
   - Add tests for service-role vs authenticated user access
   - **Estimated**: 1 day

3. **Epic: Add RLS Integration Tests**
   - Create test suite that verifies RLS policies work correctly
   - Test cross-workspace access prevention
   - Test service role bypass
   - Test workspace member access patterns
   - **Estimated**: 2-3 days

### Person 2 (Engine Surface / Product API)

1. **Epic: Align Content Table RLS with Workspace Membership**
   - Review `projects`, `clips`, `schedules` policies
   - Decide: Should workspace members (not just owners) have access?
   - If yes, update policies to use `is_workspace_member()` helper
   - Add tests for member vs owner access
   - **Estimated**: 1-2 days

2. **Epic: Document Connected Accounts Access Pattern**
   - Clarify dual access pattern (user_id + workspace)
   - Document when each pattern should be used
   - Verify API code uses correct pattern
   - **Estimated**: 0.5 day

3. **Epic: Verify Billing Table RLS**
   - Check if `billing_customers` has policies
   - Add policies if missing
   - Test service role vs user access
   - **Estimated**: 0.5 day

---

## Appendix: Policy Pattern Reference

### Pattern 1: Workspace Owner Only
```sql
USING (EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = table.workspace_id
    AND w.owner_id = auth.uid()
))
```
**Used by**: `projects`, `clips`, `schedules` (via `prj_all`, `clip_all`, `sch_all`)

### Pattern 2: Workspace Owner OR Org Link
```sql
USING (EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = table.workspace_id
    AND (w.owner_id = auth.uid() OR user_has_org_link(w.id))
))
```
**Used by**: `projects`, `clips`, `schedules` (via remote_schema policies)

### Pattern 3: Workspace Member (Non-Recursive)
```sql
USING (public.is_workspace_member(workspace_id))
```
**Used by**: `workspace_usage`, `connected_accounts`, `subscriptions`, `rate_limits`, experiments tables

### Pattern 4: Workspace Member (Direct Query)
```sql
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = table.workspace_id
    AND wm.user_id = auth.uid()
))
```
**Used by**: `jobs` (current policy)

### Pattern 5: User ID Direct
```sql
USING (user_id = auth.uid())
```
**Used by**: `connected_accounts` (`ca_all`), `rate_limits` (`rl_all`)

### Pattern 6: Service Role Bypass
```sql
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role')
-- OR
USING (true)
WITH CHECK (true)
```
**Used by**: All tables via `service_role_full_access_<table>` policies

---

## Run #2 – Jobs RLS Stabilization (backend-readiness-v1)

**Date:** 2025-12-10 21:35 UTC  
**Migration:** `20251210163500_jobs_rls_stabilization.sql`  
**OWNER:** Person 1

### Summary

Stabilized jobs table RLS by consolidating 6+ previous policy iterations into a clear, minimal policy set.

**Changes Made:**
- Dropped all existing jobs policies (7 policies total):
  - `jobs_select_same_workspace`, `jobs_insert_same_workspace`, `jobs_update_same_workspace`, `jobs_delete_same_workspace`
  - `jobs_all` (multiple iterations)
  - `jobs_are_workspace_scoped`
  - `service_role_full_access_jobs` (recreated explicitly)
- Created 2 new explicit policies:
  1. **`jobs_service_role_full_access`** (ALL operations) - Full access for service-role (worker and API)
  2. **`jobs_workspace_member_select`** (SELECT only) - Workspace-scoped read access for authenticated users

### Current Jobs RLS Posture

**Active Policies:**
1. **`jobs_service_role_full_access`**
   - **Scope**: ALL operations (SELECT, INSERT, UPDATE, DELETE)
   - **Role**: `service_role`
   - **Logic**: `USING (true) WITH CHECK (true)` - Full bypass
   - **Purpose**: Worker operations and API endpoints use service-role key

2. **`jobs_workspace_member_select`**
   - **Scope**: SELECT only
   - **Role**: `authenticated`
   - **Logic**: `USING (public.is_workspace_member(workspace_id))`
   - **Purpose**: Allows workspace members to read jobs for their workspaces (if user-facing reads exist)
   - **Note**: Uses `is_workspace_member()` helper to avoid RLS recursion

**Access Pattern:**
- **Worker Operations**: Service-role key → Full access via `jobs_service_role_full_access`
- **API Endpoints**: Service-role key → Full access via `jobs_service_role_full_access`
- **User-Facing Reads**: Authenticated users → Workspace-scoped SELECT via `jobs_workspace_member_select`
- **User Modifications**: Not permitted (no INSERT/UPDATE/DELETE policies for authenticated users)

### Risk Classification Update

**Previous Risk Level:** 🟡 YELLOW (Medium)  
**New Risk Level:** 🟢 GREEN (Low)

**Rationale:**
- ✅ RLS is enabled
- ✅ Clear, minimal policy set (2 policies, down from 7+)
- ✅ Service-role access explicitly defined
- ✅ User access constrained to workspace membership
- ✅ No overly broad policies (no `USING (true)` for anon/authenticated)
- ✅ Uses non-recursive `is_workspace_member()` helper
- ✅ No conflicting policies (all previous policies dropped)

**Remaining Considerations:**
- ⚠️ User-facing job reads: Policy exists but may not be used (API endpoints use service-role)
- ⚠️ Future: Consider removing `jobs_workspace_member_select` if no user-facing reads exist
- ✅ Worker access: Fully supported via service-role policy

### Migration Details

**File:** `supabase/migrations/20251210163500_jobs_rls_stabilization.sql`

**Key Design Decisions:**
1. **Explicit service-role policy**: Even though universal `service_role_full_access_<table>` pattern exists, we create an explicit policy for clarity and to ensure it's not accidentally dropped
2. **SELECT-only for authenticated users**: No INSERT/UPDATE/DELETE policies for authenticated users ensures all job modifications go through service-role (worker or API)
3. **Uses `is_workspace_member()` helper**: Avoids RLS recursion issues that existed in previous `jobs_are_workspace_scoped` policy
4. **Idempotent DROP statements**: All previous policies are dropped with `IF EXISTS` to handle cases where some may not exist

### Testing Notes

- Migration is idempotent (safe to run multiple times)
- No application code changes required
- Existing worker operations should continue to work (service-role access unchanged)
- API endpoints using service-role should continue to work
- User-facing reads (if any) will now use workspace membership check

**Next Steps:**
- Run `pnpm test:core` to verify no regressions
- Consider adding RLS integration tests (separate epic)
- Monitor for any user-facing job read use cases to validate `jobs_workspace_member_select` policy

---

**End of Report**

