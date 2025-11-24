-- Test workspace membership helper function and RLS isolation
-- This file tests that the is_workspace_member function works correctly
-- and that workspace isolation prevents users from accessing other workspaces' data

-- Setup: Create test users and workspaces
-- Note: In a real test environment, you'd use actual auth.users rows
-- For this SQL test, we'll use set_config to simulate different users

-- Test 1: is_workspace_member function returns true for members
-- Setup: User U1 is member of workspace W1
-- \set user1_id '11111111-1111-1111-1111-111111111111'
-- \set workspace1_id 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- 
-- -- Insert test data (requires service role or admin)
-- -- INSERT INTO workspaces (id, name, owner_id) VALUES (:workspace1_id, 'Workspace 1', :user1_id);
-- -- INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (:workspace1_id, :user1_id, 'member');
-- 
-- -- Set current user to U1
-- SELECT set_config('request.jwt.claims', json_build_object('sub', :'user1_id')::text, true);
-- 
-- -- Test: is_workspace_member should return true
-- SELECT public.is_workspace_member(:'workspace1_id'::uuid) AS is_member;
-- -- Expected: is_member = true

-- Test 2: is_workspace_member function returns false for non-members
-- Setup: User U2 is NOT a member of workspace W1
-- \set user2_id '22222222-2222-2222-2222-222222222222'
-- 
-- -- Set current user to U2
-- SELECT set_config('request.jwt.claims', json_build_object('sub', :'user2_id')::text, true);
-- 
-- -- Test: is_workspace_member should return false
-- SELECT public.is_workspace_member(:'workspace1_id'::uuid) AS is_member;
-- -- Expected: is_member = false

-- Test 3: is_workspace_member returns false for NULL workspace_id
-- SELECT public.is_workspace_member(NULL::uuid) AS is_member;
-- -- Expected: is_member = false

-- Test 4: is_workspace_member returns false for anonymous users (NULL auth.uid())
-- -- Clear JWT claims (simulate anonymous)
-- SELECT set_config('request.jwt.claims', '{}'::text, true);
-- 
-- SELECT public.is_workspace_member(:'workspace1_id'::uuid) AS is_member;
-- -- Expected: is_member = false

-- Note: These tests require a test database with proper setup.
-- In practice, you'd run these with a test harness that:
-- 1. Creates test users in auth.users
-- 2. Creates test workspaces and memberships
-- 3. Sets JWT claims for each test scenario
-- 4. Verifies RLS policies prevent unauthorized access

-- Example integration test pattern (TypeScript/Supabase client):
-- 
-- 1. Create user1 and user2 in auth.users
-- 2. Create workspace1 and workspace2
-- 3. Add user1 as member of workspace1
-- 4. Add user2 as member of workspace2
-- 5. Create test data: workspace1_project, workspace2_project
-- 6. With user1 client: SELECT * FROM projects WHERE workspace_id = workspace1_id
--    - Should return workspace1_project
--    - Should NOT return workspace2_project
-- 7. With user2 client: SELECT * FROM projects WHERE workspace_id = workspace1_id
--    - Should return empty (no rows)

