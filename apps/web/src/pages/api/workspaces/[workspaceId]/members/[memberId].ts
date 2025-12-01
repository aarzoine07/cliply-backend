import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { getAdminClient } from '@/lib/supabase';
import { isWorkspaceOwner, countWorkspaceOwners } from '@/lib/workspaces/helpers';

const UpdateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'member']),
});

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  // Get workspace ID and member ID from route parameters
  const workspaceIdParam = req.query.workspaceId;
  const memberIdParam = req.query.memberId;
  const workspaceId = Array.isArray(workspaceIdParam) ? workspaceIdParam[0] : workspaceIdParam;
  const memberId = Array.isArray(memberIdParam) ? memberIdParam[0] : memberIdParam;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json(err('invalid_request', 'Workspace ID is required'));
  }

  if (!memberId || typeof memberId !== 'string') {
    return res.status(400).json(err('invalid_request', 'Member ID is required'));
  }

  // Build auth context
  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const userId = auth.userId || auth.user_id;
  const authWorkspaceId = auth.workspaceId || auth.workspace_id;

  // Verify workspace ID matches auth context
  if (authWorkspaceId !== workspaceId) {
    return res.status(403).json(err('forbidden', 'Workspace ID mismatch'));
  }

  const supabase = getAdminClient();

  // PATCH: Update member role
  if (req.method === 'PATCH') {
    try {
      // Verify user is an owner
      const isOwner = await isWorkspaceOwner(workspaceId, userId, supabase);
      if (!isOwner) {
        return res.status(403).json(err('forbidden', 'Only workspace owners can update member roles'));
      }

      // Parse and validate request body
      let body: unknown = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
        }
      }

      const parsed = UpdateMemberRoleSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      }

      const { role: newRole } = parsed.data;

      // Fetch the member to update
      const { data: member, error: memberError } = await supabase
        .from('workspace_members')
        .select('id, user_id, role')
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (memberError) {
        logger.error('workspace_member_fetch_failed', {
          workspaceId,
          memberId,
          error: memberError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to fetch member'));
      }

      if (!member) {
        return res.status(404).json(err('not_found', 'Member not found'));
      }

      // If demoting from owner to member, check if this is the last owner
      if (member.role === 'owner' && newRole === 'member') {
        const ownerCount = await countWorkspaceOwners(workspaceId, supabase);
        if (ownerCount <= 1) {
          return res.status(400).json(
            err('invalid_request', 'Cannot demote the last owner of the workspace'),
          );
        }
      }

      // Update the member's role
      const { data: updatedMember, error: updateError } = await supabase
        .from('workspace_members')
        .update({ role: newRole })
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .select('id, user_id, role, created_at')
        .single();

      if (updateError) {
        logger.error('workspace_member_update_failed', {
          workspaceId,
          memberId,
          error: updateError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to update member role'));
      }

      // Fetch user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, raw_user_meta_data')
        .eq('id', updatedMember.user_id)
        .maybeSingle();

      if (userError) {
        logger.error('user_fetch_failed', {
          userId: updatedMember.user_id,
          error: userError.message,
        });
        // Continue anyway, user details are optional
      }

      const memberResponse = {
        id: updatedMember.id,
        userId: updatedMember.user_id,
        email: user?.email || null,
        displayName: user?.raw_user_meta_data?.display_name || user?.raw_user_meta_data?.name || null,
        role: updatedMember.role,
        createdAt: updatedMember.created_at,
      };

      logger.info('workspace_member_role_updated', {
        workspaceId,
        memberId,
        userId: member.user_id,
        oldRole: member.role,
        newRole,
        updatedBy: userId,
      });

      return res.status(200).json(ok({ member: memberResponse }));
    } catch (error) {
      logger.error('workspace_member_update_error', {
        workspaceId,
        memberId,
        message: (error as Error)?.message ?? 'unknown',
      });
      return res.status(500).json(err('internal_error', 'Failed to update member role'));
    }
  }

  // DELETE: Remove member
  if (req.method === 'DELETE') {
    try {
      // Verify user is an owner
      const isOwner = await isWorkspaceOwner(workspaceId, userId, supabase);
      if (!isOwner) {
        return res.status(403).json(err('forbidden', 'Only workspace owners can remove members'));
      }

      // Fetch the member to delete
      const { data: member, error: memberError } = await supabase
        .from('workspace_members')
        .select('id, user_id, role')
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (memberError) {
        logger.error('workspace_member_fetch_failed', {
          workspaceId,
          memberId,
          error: memberError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to fetch member'));
      }

      if (!member) {
        return res.status(404).json(err('not_found', 'Member not found'));
      }

      // If removing an owner, check if this is the last owner
      if (member.role === 'owner') {
        const ownerCount = await countWorkspaceOwners(workspaceId, supabase);
        if (ownerCount <= 1) {
          return res.status(400).json(
            err('invalid_request', 'Cannot remove the last owner of the workspace'),
          );
        }
      }

      // Delete the member
      const { error: deleteError } = await supabase
        .from('workspace_members')
        .delete()
        .eq('id', memberId)
        .eq('workspace_id', workspaceId);

      if (deleteError) {
        logger.error('workspace_member_delete_failed', {
          workspaceId,
          memberId,
          error: deleteError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to remove member'));
      }

      logger.info('workspace_member_removed', {
        workspaceId,
        memberId,
        userId: member.user_id,
        role: member.role,
        removedBy: userId,
      });

      return res.status(200).json(ok({}));
    } catch (error) {
      logger.error('workspace_member_delete_error', {
        workspaceId,
        memberId,
        message: (error as Error)?.message ?? 'unknown',
      });
      return res.status(500).json(err('internal_error', 'Failed to remove member'));
    }
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});

