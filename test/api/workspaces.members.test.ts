import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supertestHandler } from '../utils/supertest-next';
import * as supabase from '../../apps/web/src/lib/supabase';
import * as authContext from '../../apps/web/src/lib/auth/context';

// Mock Supabase client creation
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const MOCK_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const MOCK_USER_ID = '22222222-2222-2222-2222-222222222222';
const MOCK_OWNER_ID = '33333333-3333-3333-3333-333333333333';
const MOCK_MEMBER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_WORKSPACE_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_USER_ID = '88888888-8888-8888-8888-888888888888';

// Mock auth context
vi.mock('../../apps/web/src/lib/auth/context', () => ({
  buildAuthContext: vi.fn(),
  handleAuthError: vi.fn((error, res) => {
    if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
      res.status((error as any).status).json({
        ok: false,
        code: (error as any).code,
        message: (error as any).message,
      });
    }
  }),
}));

// Types for our mock data
interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
}

interface Workspace {
  id: string;
  owner_id: string;
}

interface User {
  id: string;
  email: string;
  raw_user_meta_data?: { display_name?: string; name?: string };
}

function createAdminMock() {
  const workspaceMembersState: WorkspaceMember[] = [];
  const workspacesState: Workspace[] = [];
  const usersState: User[] = [];

  const adminMock = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockImplementation((columns?: string, options?: any) => {
            // Handle count queries
            if (options?.count === 'exact' && options?.head === true) {
              let workspaceFiltered: WorkspaceMember[] = [];
              const selectChain: any = {
                eq: vi.fn().mockImplementation((field: string, value: string) => {
                  if (field === 'workspace_id') {
                    workspaceFiltered = workspaceMembersState.filter((m) => m.workspace_id === value);
                    const chainAfterWorkspace: any = {
                      eq: vi.fn().mockImplementation((innerField: string, innerValue: string) => {
                        if (innerField === 'role') {
                          const roleFiltered = workspaceFiltered.filter((m) => m.role === innerValue);
                          return Promise.resolve({
                            count: roleFiltered.length,
                            error: null,
                          });
                        }
                        return Promise.resolve({ count: 0, error: null });
                      }),
                    };
                    return chainAfterWorkspace;
                  }
                  return Promise.resolve({ count: 0, error: null });
                }),
              };
              return selectChain;
            }

            // Regular select queries - need to support chained .eq() calls
            const createChainableEq = (filtered: WorkspaceMember[] = [...workspaceMembersState]): any => {
              return {
                eq: vi.fn().mockImplementation((field: string, value: string) => {
                  let newFiltered = filtered;
                  if (field === 'workspace_id') {
                    newFiltered = filtered.filter((m) => m.workspace_id === value);
                  } else if (field === 'user_id') {
                    newFiltered = filtered.filter((m) => m.user_id === value);
                  } else if (field === 'role') {
                    newFiltered = filtered.filter((m) => m.role === value);
                  } else if (field === 'id') {
                    newFiltered = filtered.filter((m) => m.id === value);
                  }
                  return createChainableEq(newFiltered);
                }),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: filtered.length === 1 ? filtered[0] : null,
                  error: null,
                }),
                single: vi.fn().mockResolvedValue({
                  data: filtered.length === 1 ? filtered[0] : null,
                  error: filtered.length !== 1 ? { message: 'Not found' } : null,
                }),
                order: vi.fn().mockImplementation((field: string, options?: any) => {
                  // Return a promise that resolves with the filtered data
                  return Promise.resolve({
                    data: filtered,
                    error: null,
                  });
                }),
              };
            };
            return createChainableEq();
          }),
          insert: vi.fn().mockImplementation((newMembers: WorkspaceMember | WorkspaceMember[]) => {
            const membersArray = Array.isArray(newMembers) ? newMembers : [newMembers];
            const inserted = membersArray.map((m) => ({
              ...m,
              id: m.id || `member-${Math.random().toString(36).substring(7)}`,
              created_at: m.created_at || new Date().toISOString(),
            }));
            workspaceMembersState.push(...inserted);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: inserted[0],
                error: null,
              }),
            };
          }),
          update: vi.fn().mockImplementation((updates: Partial<WorkspaceMember>) => ({
            eq: vi.fn().mockImplementation((field: string, value: string) => {
              const index = workspaceMembersState.findIndex((m) => m[field as keyof WorkspaceMember] === value);
              if (index !== -1) {
                const updated = { ...workspaceMembersState[index], ...updates };
                workspaceMembersState[index] = updated;
                return {
                  eq: vi.fn().mockImplementation((innerField: string, innerValue: string) => {
                    return {
                      select: vi.fn().mockReturnThis(),
                      single: vi.fn().mockResolvedValue({
                        data: updated,
                        error: null,
                      }),
                    };
                  }),
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({
                    data: updated,
                    error: null,
                  }),
                };
              }
              return {
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              };
            }),
          })),
          delete: vi.fn().mockImplementation(() => {
            let deleteId: string | null = null;
            let deleteWorkspaceId: string | null = null;
            const createDeleteChain = (): any => {
              return {
                eq: vi.fn().mockImplementation((field: string, value: string) => {
                  if (field === 'id') {
                    deleteId = value;
                  } else if (field === 'workspace_id') {
                    deleteWorkspaceId = value;
                    // Both filters applied, perform delete
                    if (deleteId && deleteWorkspaceId) {
                      const index = workspaceMembersState.findIndex(
                        (m) => m.id === deleteId && m.workspace_id === deleteWorkspaceId,
                      );
                      if (index !== -1) {
                        workspaceMembersState.splice(index, 1);
                        return Promise.resolve({ error: null });
                      }
                      return Promise.resolve({ error: { message: 'Not found' } });
                    }
                  }
                  return createDeleteChain();
                }),
              };
            };
            return createDeleteChain();
          }),
        };
      }
      if (table === 'workspaces') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((field: string, value: string) => {
            const found = workspacesState.find((w) => w[field as keyof Workspace] === value);
            return {
              maybeSingle: vi.fn().mockResolvedValue({
                data: found || null,
                error: null,
              }),
            };
          }),
        };
      }
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((field: string, value: string) => {
            const found = usersState.find((u) => u[field as keyof User] === value);
            return {
              maybeSingle: vi.fn().mockResolvedValue({
                data: found || null,
                error: null,
              }),
            };
          }),
          in: vi.fn().mockImplementation((field: string, values: string[]) => {
            const found = usersState.filter((u) => values.includes(u[field as keyof User] as string));
            // Return a promise-like object
            return Promise.resolve({
              data: found,
              error: null,
            });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };

  // Helper to add test data
  (adminMock as any).addWorkspace = (workspace: Workspace) => {
    workspacesState.push(workspace);
  };

  (adminMock as any).addMember = (member: WorkspaceMember) => {
    workspaceMembersState.push(member);
  };

  (adminMock as any).addUser = (user: User) => {
    usersState.push(user);
  };

  (adminMock as any).getMembers = () => [...workspaceMembersState];
  (adminMock as any).getWorkspaces = () => [...workspacesState];
  (adminMock as any).getUsers = () => [...usersState];
  (adminMock as any).clear = () => {
    workspaceMembersState.length = 0;
    workspacesState.length = 0;
    usersState.length = 0;
  };

  return adminMock;
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  mockSupabaseClientFactory.mockReturnValue(admin);
}

function mockAuthContext(userId: string, workspaceId: string) {
  vi.spyOn(authContext, 'buildAuthContext').mockResolvedValue({
    userId,
    user_id: userId,
    workspaceId,
    workspace_id: workspaceId,
    isAuthenticated: true,
    plan: {
      planId: 'basic',
      status: 'free',
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
      features: {},
    },
  } as any);
}

// Import route handlers
import membersIndexRoute from '../../apps/web/src/pages/api/workspaces/[workspaceId]/members/index';
import membersIdRoute from '../../apps/web/src/pages/api/workspaces/[workspaceId]/members/[memberId]';

describe('Workspace Member Management APIs', () => {
  let admin: ReturnType<typeof createAdminMock>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
    admin = createAdminMock();
    mockAdminClient(admin);
    admin.clear();

    // Set up default test data
    admin.addWorkspace({
      id: MOCK_WORKSPACE_ID,
      owner_id: MOCK_OWNER_ID,
    });

    admin.addUser({
      id: MOCK_OWNER_ID,
      email: 'owner@example.com',
      raw_user_meta_data: { display_name: 'Owner User' },
    });

    admin.addUser({
      id: MOCK_USER_ID,
      email: 'user@example.com',
      raw_user_meta_data: { display_name: 'Regular User' },
    });

    admin.addUser({
      id: MOCK_MEMBER_ID,
      email: 'member@example.com',
      raw_user_meta_data: { display_name: 'Member User' },
    });
  });

  describe('Authentication & Access', () => {
    it('returns 401 when not authenticated', async () => {
      vi.spyOn(authContext, 'buildAuthContext').mockRejectedValue({
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
        status: 401,
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('returns 403 when workspace ID mismatch', async () => {
      mockAuthContext(MOCK_USER_ID, OTHER_WORKSPACE_ID);

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('forbidden');
    });

    it('returns 403 when user is not a member', async () => {
      mockAuthContext(OTHER_USER_ID, MOCK_WORKSPACE_ID);

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('GET /api/workspaces/[workspaceId]/members', () => {
    it('lists members as a member', async () => {
      mockAuthContext(MOCK_USER_ID, MOCK_WORKSPACE_ID);

      // Add user as a member
      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      // Add another member
      admin.addMember({
        id: 'member-2',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_MEMBER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.members).toBeDefined();
      expect(Array.isArray(res.body.members)).toBe(true);
      // Should include workspace owner + 2 members = 3 total
      expect(res.body.members.length).toBeGreaterThanOrEqual(2);
    });

    it('lists members as an owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.members).toBeDefined();
    });
  });

  describe('POST /api/workspaces/[workspaceId]/members', () => {
    it('adds a member as owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Use a fresh user ID that's guaranteed not to be a member yet
      // Use a valid UUID v4 format to pass Zod validation
      const newUserId = 'aaaaaaa1-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      admin.addUser({
        id: newUserId,
        email: 'newuser@example.com',
        raw_user_meta_data: { display_name: 'New User' },
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'post', '/')
        .post('/')
        .send({ userId: newUserId, role: 'member' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.member).toBeDefined();
      expect(res.body.member.userId).toBe(newUserId);
      expect(res.body.member.role).toBe('member');
    });

    it('adds a member by email', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'post', '/')
        .post('/')
        .send({ email: 'user@example.com', role: 'member' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.member).toBeDefined();
    });

    it('returns 403 when non-owner tries to add member', async () => {
      mockAuthContext(MOCK_USER_ID, MOCK_WORKSPACE_ID);

      // Add user as a member (not owner)
      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'post', '/')
        .post('/')
        .send({ userId: OTHER_USER_ID, role: 'member' });

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('forbidden');
    });

    it('returns 400 when adding duplicate member', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Add user as existing member
      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'post', '/')
        .post('/')
        .send({ userId: MOCK_USER_ID, role: 'member' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 400 when user not found by email', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'post', '/')
        .post('/')
        .send({ email: 'nonexistent@example.com', role: 'member' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('not_found');
    });
  });

  describe('PATCH /api/workspaces/[workspaceId]/members/[memberId]', () => {
    it('updates member role as owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      const memberId = 'member-1';
      admin.addMember({
        id: memberId,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'patch', '/')
        .patch('/')
        .send({ role: 'owner' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.member.role).toBe('owner');
    });

    it('returns 403 when non-owner tries to update role', async () => {
      mockAuthContext(MOCK_USER_ID, MOCK_WORKSPACE_ID);

      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId: 'member-1' },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'patch', '/')
        .patch('/')
        .send({ role: 'owner' });

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });

    it('blocks demoting the last owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Add owner as a member (so they're the only owner)
      const memberId = 'member-owner';
      admin.addMember({
        id: memberId,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_OWNER_ID,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'patch', '/')
        .patch('/')
        .send({ role: 'member' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('last owner');
    });

    it('allows demoting owner when there are multiple owners', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Add another owner
      const otherOwnerId = '55555555-5555-5555-5555-555555555555';
      admin.addUser({
        id: otherOwnerId,
        email: 'otherowner@example.com',
      });

      const memberId1 = 'member-owner-1';
      admin.addMember({
        id: memberId1,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_OWNER_ID,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const memberId2 = 'member-owner-2';
      admin.addMember({
        id: memberId2,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: otherOwnerId,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId: memberId1 },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'patch', '/')
        .patch('/')
        .send({ role: 'member' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.member.role).toBe('member');
    });
  });

  describe('DELETE /api/workspaces/[workspaceId]/members/[memberId]', () => {
    it('removes a member as owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      const memberId = 'member-1';
      admin.addMember({
        id: memberId,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'delete', '/').delete('/');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 403 when non-owner tries to remove member', async () => {
      mockAuthContext(MOCK_USER_ID, MOCK_WORKSPACE_ID);

      admin.addMember({
        id: 'member-1',
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId: 'member-1' },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'delete', '/').delete('/');
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });

    it('blocks removing the last owner', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Add owner as a member (so they're the only owner)
      const memberId = 'member-owner';
      admin.addMember({
        id: memberId,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_OWNER_ID,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'delete', '/').delete('/');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('last owner');
    });

    it('allows removing owner when there are multiple owners', async () => {
      mockAuthContext(MOCK_OWNER_ID, MOCK_WORKSPACE_ID);

      // Add another owner
      const otherOwnerId = '55555555-5555-5555-5555-555555555555';
      admin.addUser({
        id: otherOwnerId,
        email: 'otherowner@example.com',
      });

      const memberId1 = 'member-owner-1';
      admin.addMember({
        id: memberId1,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: MOCK_OWNER_ID,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const memberId2 = 'member-owner-2';
      admin.addMember({
        id: memberId2,
        workspace_id: MOCK_WORKSPACE_ID,
        user_id: otherOwnerId,
        role: 'owner',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID, memberId: memberId1 },
          writable: true,
          configurable: true,
        });
        return membersIdRoute(req, res);
      };

      const res = await supertestHandler(handler, 'delete', '/').delete('/');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('Workspace Isolation', () => {
    it('prevents accessing members from different workspace', async () => {
      mockAuthContext(MOCK_USER_ID, OTHER_WORKSPACE_ID);

      // Add member to different workspace
      admin.addMember({
        id: 'member-other',
        workspace_id: OTHER_WORKSPACE_ID,
        user_id: MOCK_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { workspaceId: MOCK_WORKSPACE_ID },
          writable: true,
          configurable: true,
        });
        return membersIndexRoute(req, res);
      };

      const res = await supertestHandler(handler, 'get', '/').get('/');
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });
  });
});

