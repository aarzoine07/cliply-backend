import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { getAdminClient } from '@/lib/supabase';
import { isWorkspaceOwner, getUserWorkspaceRole } from '@/lib/workspaces/helpers';

const AddMemberSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  role: z.enum(['owner', 'member']).default('member'),
});

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  // Get workspace ID from route parameter
  const workspaceIdParam = req.query.workspaceId;
  const workspaceId = Array.isArray(workspaceIdParam) ? workspaceIdParam[0] : workspaceIdParam;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json(err('invalid_request', 'Workspace ID is required'));
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

  // GET: List members
  if (req.method === 'GET') {
    try {
      // Verify user is a member of the workspace
      const role = await getUserWorkspaceRole(workspaceId, userId, supabase);
      if (!role) {
        return res.status(403).json(err('forbidden', 'User is not a member of this workspace'));
      }

      // Fetch all members with user details
      const { data: members, error: membersError } = await supabase
        .from('workspace_members')
        .select('id, user_id, role, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (membersError) {
        logger.error('workspace_members_list_failed', {
          workspaceId,
          error: membersError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to list members'));
      }

      // Also check if workspace has an owner_id that might not be in workspace_members
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('owner_id')
        .eq('id', workspaceId)
        .maybeSingle();

      if (workspaceError) {
        logger.error('workspace_fetch_failed', {
          workspaceId,
          error: workspaceError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to fetch workspace'));
      }

      // Fetch user details for all members
      const userIds = (members || []).map((m: any) => m.user_id);
      let users: any[] = [];
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from('users')
          .select('id, email, raw_user_meta_data')
          .in('id', userIds);
        
        if (usersResult.error) {
          logger.error('users_fetch_failed', {
            workspaceId,
            error: usersResult.error.message,
          });
          return res.status(500).json(err('internal_error', 'Failed to fetch user details'));
        }
        users = usersResult.data || [];
      }


      const usersMap = new Map((users || []).map((u: any) => [u.id, u]));

      // Transform members to response format
      const membersList = (members || []).map((member: any) => {
        const user = usersMap.get(member.user_id);
        return {
          id: member.id,
          userId: member.user_id,
          email: user?.email || null,
          displayName: user?.raw_user_meta_data?.display_name || user?.raw_user_meta_data?.name || null,
          role: member.role,
          createdAt: member.created_at,
        };
      });

      // If workspace has an owner_id not in members list, add them
      if (workspace?.owner_id) {
        const ownerInMembers = membersList.some((m: any) => m.userId === workspace.owner_id);
        if (!ownerInMembers) {
          // Fetch owner user details
          const { data: ownerUser, error: ownerUserError } = await supabase
            .from('users')
            .select('id, email, raw_user_meta_data')
            .eq('id', workspace.owner_id)
            .maybeSingle();

          if (!ownerUserError && ownerUser) {
            membersList.unshift({
              id: `owner-${workspace.owner_id}`, // Virtual ID for workspace owner
              userId: workspace.owner_id,
              email: ownerUser.email || null,
              displayName: ownerUser.raw_user_meta_data?.display_name || ownerUser.raw_user_meta_data?.name || null,
              role: 'owner',
              createdAt: null, // Workspace owner doesn't have a created_at in workspace_members
            });
          }
        }
      }

      logger.info('workspace_members_listed', {
        workspaceId,
        userId,
        count: membersList.length,
      });

      return res.status(200).json(ok({ members: membersList }));
    } catch (error) {
      logger.error('workspace_members_list_error', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      return res.status(500).json(err('internal_error', 'Failed to list members'));
    }
  }

  // POST: Add member
  if (req.method === 'POST') {
    try {
      // Verify user is an owner
      const isOwner = await isWorkspaceOwner(workspaceId, userId, supabase);
      if (!isOwner) {
        return res.status(403).json(err('forbidden', 'Only workspace owners can add members'));
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

      const parsed = AddMemberSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      }

      const { userId: targetUserId, email, role } = parsed.data;

      // Must provide either userId or email
      if (!targetUserId && !email) {
        return res.status(400).json(err('invalid_request', 'Either userId or email is required'));
      }

      let finalUserId: string;

      if (targetUserId) {
        finalUserId = targetUserId;
      } else if (email) {
        // Lookup user by email
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (userError) {
          logger.error('user_lookup_failed', {
            email,
            error: userError.message,
          });
          return res.status(500).json(err('internal_error', 'Failed to lookup user'));
        }

        if (!user) {
          return res.status(400).json(err('not_found', 'User not found with the provided email'));
        }

        finalUserId = user.id;
      } else {
        return res.status(400).json(err('invalid_request', 'Either userId or email is required'));
      }

      // Check if user is already a member
      const { data: existingMember, error: existingError } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', finalUserId)
        .maybeSingle();

      if (existingError) {
        logger.error('workspace_member_check_failed', {
          workspaceId,
          userId: finalUserId,
          error: existingError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to check existing membership'));
      }

      if (existingMember) {
        return res.status(400).json(err('invalid_request', 'User is already a member of this workspace'));
      }

      // Insert new member
      const { data: newMember, error: insertError } = await supabase
        .from('workspace_members')
        .insert({
          workspace_id: workspaceId,
          user_id: finalUserId,
          role: role || 'member',
        })
        .select('id, user_id, role, created_at')
        .single();

      if (insertError) {
        logger.error('workspace_member_add_failed', {
          workspaceId,
          userId: finalUserId,
          error: insertError.message,
        });
        return res.status(500).json(err('internal_error', 'Failed to add member'));
      }

      // Fetch user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, raw_user_meta_data')
        .eq('id', finalUserId)
        .maybeSingle();

      if (userError) {
        logger.error('user_fetch_failed', {
          userId: finalUserId,
          error: userError.message,
        });
        // Continue anyway, user details are optional
      }

      const memberResponse = {
        id: newMember.id,
        userId: newMember.user_id,
        email: user?.email || null,
        displayName: user?.raw_user_meta_data?.display_name || user?.raw_user_meta_data?.name || null,
        role: newMember.role,
        createdAt: newMember.created_at,
      };

      logger.info('workspace_member_added', {
        workspaceId,
        userId: finalUserId,
        role: role || 'member',
        addedBy: userId,
      });

      return res.status(200).json(ok({ member: memberResponse }));
    } catch (error) {
      logger.error('workspace_member_add_error', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      return res.status(500).json(err('internal_error', 'Failed to add member'));
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});

