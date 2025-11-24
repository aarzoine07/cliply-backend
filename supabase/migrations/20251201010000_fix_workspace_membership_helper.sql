-- Fix workspace membership RLS recursion issue
-- This migration creates a non-recursive membership helper function and updates all RLS policies to use it

-- Step 1: Create non-recursive membership helper function
-- This function uses SECURITY DEFINER to bypass RLS on workspace_members
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO anon;

-- Step 2: Fix workspace_members table policies to avoid recursion
-- Drop existing recursive policy
DROP POLICY IF EXISTS "workspace_members_member_read" ON public.workspace_members;

-- Create new policy that allows users to see their own memberships directly
-- This is safe because we check auth.uid() directly without querying workspace_members
CREATE POLICY "workspace_members_member_read"
  ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Step 3: Update workspace-scoped table policies to use the helper function
-- These policies currently query workspace_members directly, causing recursion

-- Workspace usage table
DROP POLICY IF EXISTS workspace_usage_workspace_member_read ON public.workspace_usage;
CREATE POLICY workspace_usage_workspace_member_read
  ON public.workspace_usage
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Experiments table
DROP POLICY IF EXISTS experiments_workspace_member_access ON public.experiments;
CREATE POLICY experiments_workspace_member_access
  ON public.experiments
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Experiment variants table
DROP POLICY IF EXISTS experiment_variants_workspace_member_access ON public.experiment_variants;
CREATE POLICY experiment_variants_workspace_member_access
  ON public.experiment_variants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.experiments e
      WHERE e.id = experiment_variants.experiment_id
        AND public.is_workspace_member(e.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.experiments e
      WHERE e.id = experiment_variants.experiment_id
        AND public.is_workspace_member(e.workspace_id)
    )
  );

-- Variant posts table
DROP POLICY IF EXISTS variant_posts_workspace_member_access ON public.variant_posts;
CREATE POLICY variant_posts_workspace_member_access
  ON public.variant_posts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.experiment_variants ev
      JOIN public.experiments e ON e.id = ev.experiment_id
      WHERE ev.id = variant_posts.variant_id
        AND public.is_workspace_member(e.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.experiment_variants ev
      JOIN public.experiments e ON e.id = ev.experiment_id
      WHERE ev.id = variant_posts.variant_id
        AND public.is_workspace_member(e.workspace_id)
    )
  );

-- Variant metrics table
DROP POLICY IF EXISTS variant_metrics_workspace_member_access ON public.variant_metrics;
CREATE POLICY variant_metrics_workspace_member_access
  ON public.variant_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.variant_posts vp
      JOIN public.experiment_variants ev ON ev.id = vp.variant_id
      JOIN public.experiments e ON e.id = ev.experiment_id
      WHERE vp.id = variant_metrics.variant_post_id
        AND public.is_workspace_member(e.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.variant_posts vp
      JOIN public.experiment_variants ev ON ev.id = vp.variant_id
      JOIN public.experiments e ON e.id = ev.experiment_id
      WHERE vp.id = variant_metrics.variant_post_id
        AND public.is_workspace_member(e.workspace_id)
    )
  );

-- Products table
DROP POLICY IF EXISTS products_workspace_member_access ON public.products;
CREATE POLICY products_workspace_member_access
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Clip products table
DROP POLICY IF EXISTS clip_products_workspace_member_access ON public.clip_products;
CREATE POLICY clip_products_workspace_member_access
  ON public.clip_products
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.id = clip_products.clip_id
        AND public.is_workspace_member(c.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.id = clip_products.clip_id
        AND public.is_workspace_member(c.workspace_id)
    )
  );

-- Dropshipping actions table
DROP POLICY IF EXISTS dropshipping_actions_workspace_member_access ON public.dropshipping_actions;
CREATE POLICY dropshipping_actions_workspace_member_access
  ON public.dropshipping_actions
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Step 4: Update policies from remote_schema.sql that query workspace_members directly
-- These are in the remote_schema migration and need to be updated

-- Connected accounts
DROP POLICY IF EXISTS "connected_accounts_workspace_member_read" ON public.connected_accounts;
CREATE POLICY "connected_accounts_workspace_member_read"
  ON public.connected_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "connected_accounts_workspace_member_modify" ON public.connected_accounts;
CREATE POLICY "connected_accounts_workspace_member_modify"
  ON public.connected_accounts
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- DMCA reports
DROP POLICY IF EXISTS "dmca_reports_workspace_member_read" ON public.dmca_reports;
CREATE POLICY "dmca_reports_workspace_member_read"
  ON public.dmca_reports
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "dmca_reports_workspace_member_modify" ON public.dmca_reports;
CREATE POLICY "dmca_reports_workspace_member_modify"
  ON public.dmca_reports
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Events audit
DROP POLICY IF EXISTS "events_audit_workspace_member_read" ON public.events_audit;
CREATE POLICY "events_audit_workspace_member_read"
  ON public.events_audit
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Rate limits
DROP POLICY IF EXISTS "rate_limits_workspace_member_read" ON public.rate_limits;
CREATE POLICY "rate_limits_workspace_member_read"
  ON public.rate_limits
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Subscriptions
DROP POLICY IF EXISTS "subscriptions_workspace_member_read" ON public.subscriptions;
CREATE POLICY "subscriptions_workspace_member_read"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Step 5: Update workspaces table policy that queries workspace_members
-- This policy exists in an early migration and should also use the helper function
DROP POLICY IF EXISTS "workspaces_member_select" ON public.workspaces;
CREATE POLICY "workspaces_member_select"
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(id) OR owner_id = auth.uid());

-- Note: Policies for workspaces, projects, clips, schedules, jobs, events, etc. that check owner_id
-- directly from workspaces table don't need changes as they don't query workspace_members recursively.
-- Only policies that query workspace_members directly need to be updated.

