import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Check if a user is an owner of a workspace.
 * A user is an owner if:
 * 1. The workspace's owner_id matches the user_id, OR
 * 2. The user has a workspace_members row with role = 'owner'
 */
export async function isWorkspaceOwner(
  workspaceId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  // Check if user is the workspace owner via workspaces.owner_id
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Failed to check workspace ownership: ${workspaceError.message}`);
  }

  if (!workspace) {
    return false;
  }

  // Check if user is the workspace owner
  if (workspace.owner_id === userId) {
    return true;
  }

  // Also check if user has owner role in workspace_members
  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Failed to check workspace membership: ${membershipError.message}`);
  }

  return membership !== null;
}

/**
 * Get the user's role in a workspace.
 * Returns 'owner' if the user is the workspace owner or has owner role in workspace_members,
 * 'member' if they have member role, or null if not a member.
 */
export async function getUserWorkspaceRole(
  workspaceId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<'owner' | 'member' | null> {
  const isOwner = await isWorkspaceOwner(workspaceId, userId, supabase);
  if (isOwner) {
    return 'owner';
  }

  // Check if user is a member
  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Failed to check workspace membership: ${membershipError.message}`);
  }

  if (!membership) {
    return null;
  }

  return membership.role as 'owner' | 'member';
}

/**
 * Count the number of owners in a workspace.
 */
export async function countWorkspaceOwners(
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<number> {
  // Count owners via workspace_members with role = 'owner'
  const { count, error: membersError } = await supabase
    .from('workspace_members')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner');

  if (membersError) {
    throw new Error(`Failed to count workspace owners: ${membersError.message}`);
  }

  // Also check if workspace has an owner_id that might not be in workspace_members
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Failed to check workspace: ${workspaceError.message}`);
  }

  if (!workspace) {
    return 0;
  }

  // If workspace has an owner_id, check if they're already counted in workspace_members
  const memberCount = count ?? 0;
  if (workspace.owner_id) {
    const { data: ownerMember, error: ownerMemberError } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', workspace.owner_id)
      .maybeSingle();

    if (ownerMemberError) {
      throw new Error(`Failed to check owner membership: ${ownerMemberError.message}`);
    }

    // If owner_id is not in workspace_members, add 1 to the count
    if (!ownerMember) {
      return memberCount + 1;
    }
  }

  return memberCount;
}

