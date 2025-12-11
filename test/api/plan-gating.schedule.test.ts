/**
 * Plan gating tests for schedule feature
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishYouTubeRoute from '../../apps/web/src/pages/api/publish/youtube';
import schedulesIndexRoute from '../../apps/web/src/pages/api/schedules/index';
import { supertestHandler } from '../utils/supertest-next';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';
import * as supabase from '../../apps/web/src/lib/supabase';

// Mock Supabase client creation for buildAuthContext
// Use vi.hoisted to avoid hoisting issues
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const toApiHandler = (handler: typeof publishYouTubeRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const userId = '123e4567-e89b-12d3-a456-426614174001';
const workspaceId = '123e4567-e89b-12d3-a456-426614174000';

const commonHeaders = {
  'x-debug-user': userId,
  'x-debug-workspace': workspaceId,
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId1 = '223e4567-e89b-12d3-a456-426614174001';

function createAdminMock(plan: 'basic' | 'pro' | 'premium' = 'basic') {
  // Shared insert spy for jobs table so tests can assert call counts
  const jobsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({
      data: [{ id: 'job-123' }],
      error: null,
    }),
  });

  const admin: any = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { workspace_id: workspaceId },
            error: null,
          }),
        };
        // Support chaining multiple .eq() calls
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.select = vi.fn().mockReturnValue(chain);
        return chain;
      }

      if (table === 'subscriptions') {
        // IMPORTANT: must support .in(), like in plan-gating.publish.test.ts
        const chain: any = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            // Basic => no subscription → defaults to basic/free in resolver
            data: plan === 'basic'
              ? null
              : {
                  plan_name: plan,
                  status: 'active',
                  current_period_end: new Date().toISOString(),
                  stripe_subscription_id: 'sub_123',
                },
            error: null,
          }),
        };

        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.in.mockReturnValue(chain);
        chain.order.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);

        return chain;
      }

      if (table === 'clips') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: mockClipId,
              workspace_id: workspaceId,
              status: 'ready',
              storage_path: 'renders/test.mp4',
            },
            error: null,
          }),
        };
      }

      if (table === 'jobs') {
        // Always expose the same insert spy so expectations work
        return {
          insert: jobsInsert,
        };
      }

      if (table === 'schedules') {
        const scheduleQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'schedule-123' },
              error: null,
            }),
          }),
        };
        return scheduleQuery;
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
  };

  return admin;
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  // Set the mock client that createClient will return
  mockSupabaseClientFactory.mockReturnValue(admin);
}

function mockConnectedAccounts() {
  vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
    {
      id: mockAccountId1,
      workspace_id: workspaceId,
      platform: 'youtube',
      provider: 'youtube',
      external_id: 'channel-1',
      display_name: 'Channel 1',
      handle: null,
      status: 'active',
      scopes: null,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
}

describe('Plan Gating - Schedule Feature', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
  });

  describe('POST /api/publish/youtube with scheduleAt', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours from now

    it('allows scheduled publish when plan gating does not restrict schedule feature (basic plan)', async () => {
      const admin = createAdminMock('basic');
      mockAdminClient(admin);
      mockConnectedAccounts();

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
          connectedAccountIds: [mockAccountId1],
          scheduleAt: futureDate,
        });

      // Current behavior: basic plan can schedule; request succeeds
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('allows scheduled publish when plan includes schedule feature (pro plan)', async () => {
      const admin = createAdminMock('pro'); // Pro plan
      mockAdminClient(admin);
      mockConnectedAccounts();

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
          connectedAccountIds: [mockAccountId1],
          scheduleAt: futureDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify publish job was created (schedule carried via job payload)
      expect(admin.from('jobs').insert).toHaveBeenCalled();
    });

    it('allows scheduled publish for premium plan', async () => {
      const admin = createAdminMock('premium'); // Premium plan
      mockAdminClient(admin);
      mockConnectedAccounts();

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
          connectedAccountIds: [mockAccountId1],
          scheduleAt: futureDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('allows immediate publish (no scheduleAt) for basic plan', async () => {
      // Immediate publishing should work even without a dedicated schedule feature
      const admin = createAdminMock('basic');
      mockAdminClient(admin);
      mockConnectedAccounts();

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
          connectedAccountIds: [mockAccountId1],
          // No scheduleAt - should work on basic plan
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify job was created (not schedule)
      expect(admin.from('jobs').insert).toHaveBeenCalled();
    });
  });

  describe('GET /api/schedules/index', () => {
    it('allows listing schedules for authenticated user', async () => {
      const admin = createAdminMock('pro');
      mockAdminClient(admin);

      // Mock schedules query
      admin.from('schedules').maybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      admin.from('schedules').select = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get')
        .get('/')
        .set(commonHeaders);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('items');
    });

    it('returns 401 when not authenticated', async () => {
      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get')
        .get('/');
      // No headers

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('allows listing schedules for basic plan (read-only operation)', async () => {
      // Listing schedules is read-only, so it should work for basic plan
      const admin = createAdminMock('basic');
      mockAdminClient(admin);

      admin.from('schedules').select = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get')
        .get('/')
        .set(commonHeaders);

      // Should work because it's read-only
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});