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

/**
 * NOTE (T2/RLS):
 * Some routes now require an access token (Authorization: Bearer ...) even in debug mode,
 * because they must use the RLS client.
 */
const commonHeaders = {
  'x-debug-user': userId,
  'x-debug-workspace': workspaceId,
  authorization: 'Bearer test-token',
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId1 = '223e4567-e89b-12d3-a456-426614174001';

type ThenableResult<T> = {
  data: T;
  error: null | { message?: string } | unknown;
  count?: number;
};

function createThenableQuery<T>(result: ThenableResult<T>) {
  const builder: any = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),

    // Make it awaitable: await builder -> resolves to { data, error, count? }
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch(onRejected: any) {
      return Promise.resolve(result).catch(onRejected);
    },
    finally(onFinally: any) {
      return Promise.resolve(result).finally(onFinally);
    },
  };

  // Chain methods return the same builder unless a route awaits at the end.
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.range.mockReturnValue(builder);

  return builder;
}

function createAdminMock(plan: 'basic' | 'pro' | 'premium' = 'basic') {
  // Shared insert spy for jobs table so tests can assert call counts
  const jobsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({
      data: [{ id: 'job-123' }],
      error: null,
    }),
  });

  // subscription resolver expectation
  const subscriptionData =
    plan === 'basic'
      ? null
      : {
          plan_name: plan,
          status: 'active',
          current_period_end: new Date().toISOString(),
          stripe_subscription_id: 'sub_123',
        };

  const workspaceMembersQuery = createThenableQuery<{ workspace_id: string }>({
    data: { workspace_id: workspaceId },
    error: null,
  });

  const subscriptionsQuery = createThenableQuery<typeof subscriptionData>({
    data: subscriptionData as any,
    error: null,
  });

  const clipsQuery = createThenableQuery<{
    id: string;
    workspace_id: string;
    status: string;
    storage_path: string;
  }>({
    data: {
      id: mockClipId,
      workspace_id: workspaceId,
      status: 'ready',
      storage_path: 'renders/test.mp4',
    },
    error: null,
  });

  const schedulesListQuery = createThenableQuery<any[]>({
    data: [],
    error: null,
    count: 0,
  });

  const schedulesInsertResult = {
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'schedule-123' },
      error: null,
    }),
  };

  const schedulesTable: any = {
    // Listing path (awaitable query builder)
    ...schedulesListQuery,

    // Insert path (some routes may insert schedules)
    insert: vi.fn().mockReturnValue(schedulesInsertResult),
  };

  const admin: any = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members') return workspaceMembersQuery;
      if (table === 'subscriptions') return subscriptionsQuery;
      if (table === 'clips') return clipsQuery;

      if (table === 'jobs') {
        return {
          insert: jobsInsert,
        };
      }

      if (table === 'schedules') return schedulesTable;

      // fallback: awaitable empty query
      return createThenableQuery<null>({ data: null, error: null });
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
  // Any createClient() calls (shared auth / RLS client) will return this mock too
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
          // No scheduleAt
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

      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get')
        .get('/')
        .set(commonHeaders);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('items');
    });

    it('returns 401 when not authenticated', async () => {
      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get').get('/');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('allows listing schedules for basic plan (read-only operation)', async () => {
      // Listing schedules is read-only, so it should work for basic plan
      const admin = createAdminMock('basic');
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(schedulesIndexRoute as any), 'get')
        .get('/')
        .set(commonHeaders);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});