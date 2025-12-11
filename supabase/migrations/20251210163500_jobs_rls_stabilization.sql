-- Epic 6: Stabilize jobs table RLS policies
-- This migration consolidates all previous jobs RLS policy iterations into a clear, minimal set.
-- 
-- Design:
--   - Service-role: Full access (for worker operations and API endpoints)
--   - Authenticated users: Workspace-scoped SELECT only (for user-facing reads if any)
--   - No INSERT/UPDATE/DELETE for authenticated users (only service role can modify jobs)
--
-- This replaces all previous policies:
--   - jobs_select_same_workspace, jobs_insert_same_workspace, jobs_update_same_workspace, jobs_delete_same_workspace
--   - jobs_all (multiple iterations)
--   - jobs_are_workspace_scoped

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Drop all existing jobs policies to start clean
-- This ensures no conflicting or overly broad policies remain
DROP POLICY IF EXISTS "jobs_select_same_workspace" ON public.jobs;
DROP POLICY IF EXISTS "jobs_insert_same_workspace" ON public.jobs;
DROP POLICY IF EXISTS "jobs_update_same_workspace" ON public.jobs;
DROP POLICY IF EXISTS "jobs_delete_same_workspace" ON public.jobs;
DROP POLICY IF EXISTS "jobs_all" ON public.jobs;
DROP POLICY IF EXISTS "jobs_are_workspace_scoped" ON public.jobs;
DROP POLICY IF EXISTS "service_role_full_access_jobs" ON public.jobs;

-- Policy 1: Service-role full access
-- Worker operations and API endpoints use service-role key, which bypasses RLS via this policy
CREATE POLICY "jobs_service_role_full_access"
  ON public.jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy 2: Workspace-scoped SELECT for authenticated users
-- Allows workspace members to read jobs for their workspaces (if user-facing reads exist)
-- Uses is_workspace_member() helper to avoid RLS recursion issues
CREATE POLICY "jobs_workspace_member_select"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
  );

-- Note: No INSERT/UPDATE/DELETE policies for authenticated users
-- Only service-role can create, update, or delete jobs
-- This ensures:
--   - Worker operations (via service role) can manage jobs
--   - API endpoints (via service role) can create/update jobs
--   - Users cannot directly modify jobs (must go through API with proper authorization)

