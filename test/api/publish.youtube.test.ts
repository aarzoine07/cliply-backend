import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishYouTubeRoute from '../../apps/web/src/pages/api/publish/youtube';
import { supertestHandler } from '../utils/supertest-next';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';
import * as orchestrationService from '../../apps/web/src/lib/viral/orchestrationService';
import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import * as supabase from '../../apps/web/src/lib/supabase';
import * as rateLimit from '../../apps/web/src/lib/rate-limit';
// Mock Supabase client creation for buildAuthContext
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

// Mock withIdempotency to always execute fresh (so jobs.insert is called)
// Mock both the relative path and the alias path to ensure it works
vi.mock('../../apps/web/src/lib/idempotency', async () => {
  const actual = await vi.importActual('../../apps/web/src/lib/idempotency');
  return {
    ...actual,
    withIdempotency: vi.fn(async (key: string, exec: () => Promise<any>) => {
      const value = await exec();
      return { fresh: true, value, responseHash: 'mock-hash' };
    }),
  };
});
vi.mock('@/lib/idempotency', async () => {
  const actual = await vi.importActual('../../apps/web/src/lib/idempotency');
  return {
    ...actual,
    withIdempotency: vi.fn(async (key: string, exec: () => Promise<any>) => {
      const value = await exec();
      return { fresh: true, value, responseHash: 'mock-hash' };
    }),
  };
});

const toApiHandler = (handler: typeof publishYouTubeRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId1 = '223e4567-e89b-12d3-a456-426614174001';
const mockAccountId2 = '323e4567-e89b-12d3-a456-426614174002';
const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';
const userId = '00000000-0000-0000-0000-000000000001';

function createAdminMock() {
  // Create a stable insert function that can be spied on
  const jobsInsertChain = {
    select: vi.fn().mockResolvedValue({
      data: [{ id: 'job-123' }],
      error: null,
    }),
  };
  const jobsInsertFn = vi.fn().mockReturnValue(jobsInsertChain);

  const adminMock = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'clips') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: mockClipId,
              workspace_id: mockWorkspaceId,
              status: 'ready',
              storage_path: 'renders/test.mp4',
            },
            error: null,
          }),
        };
      }
      if (table === 'jobs') {
        const jobsSelectChain = {
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [], // Return empty array for resolveExistingPublishResult queries (so it doesn't find existing jobs)
            error: null,
          }),
        };
        // Support chaining for jobs queries (multiple .eq() calls)
        jobsSelectChain.eq = vi.fn().mockReturnValue(jobsSelectChain);
        return {
          insert: jobsInsertFn, // Use the stable function reference
          select: vi.fn().mockReturnValue(jobsSelectChain),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [], // Return empty array for resolveExistingPublishResult queries
            error: null,
          }),
        };
      }
      if (table === 'schedules') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        };
      }
      if (table === 'workspace_members') {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { workspace_id: mockWorkspaceId },
            error: null,
          }),
        };
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.select = vi.fn().mockReturnValue(chain);
        return chain;
      }
      if (table === 'subscriptions') {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: mockWorkspaceId,
              plan_name: 'pro',
              status: 'active',
            },
            error: null,
          }),
        };
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockReturnValue(chain);
        chain.select = vi.fn().mockReturnValue(chain);
        chain.order = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        return chain;
      }
      if (table === 'idempotency') {
        const idempotencySelectChain = {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null, // Always return null so idempotency check passes (fresh execution)
            error: null,
          }),
        };
        // Support chaining
        idempotencySelectChain.eq = vi.fn().mockReturnValue(idempotencySelectChain);
        return {
          select: vi.fn().mockReturnValue(idempotencySelectChain),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null, // Always return null so idempotency check passes (fresh execution)
            error: null,
          }),
          upsert: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
    rpc: vi.fn().mockResolvedValue({
      data: 60, // Return remaining tokens
      error: null,
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    // Expose the jobs insert function for tests to spy on
    _jobsInsert: jobsInsertFn,
  };
  return adminMock;
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  // Set the mock client that createClient will return for buildAuthContext
  mockSupabaseClientFactory.mockReturnValue(admin);
}

describe('POST /api/publish/youtube', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
    // Mock rate limiting to always allow
    vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
      allowed: true,
      remaining: 60,
    });
  });

  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(publishYouTubeRoute)).post('/').send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid payload', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({ clipId: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when clip not found', async () => {
    const admin = createAdminMock();
    // Override the clips table mock to return null
    admin.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'clips') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null, // Clip not found
            error: null,
          }),
        };
      }
      // Return default mock for other tables
      return createAdminMock().from(table);
    });
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
      });
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('enqueues single PUBLISH_YOUTUBE job for single account', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
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

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        connectedAccountIds: [mockAccountId1],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Use the stable insert function reference stored on the admin mock
    expect((admin as any)._jobsInsert).toHaveBeenCalledTimes(1);
    const insertCall = (admin as any)._jobsInsert.mock.calls[0][0];
    expect(insertCall).toHaveLength(1);
    expect(insertCall[0].payload.connectedAccountId).toBe(mockAccountId1);
  });

  it('enqueues multiple PUBLISH_YOUTUBE jobs for multiple accounts', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
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
      {
        id: mockAccountId2,
        workspace_id: mockWorkspaceId,
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-2',
        display_name: 'Channel 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        connectedAccountIds: [mockAccountId1, mockAccountId2],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Use the stable insert function reference stored on the admin mock
    expect((admin as any)._jobsInsert).toHaveBeenCalledTimes(1);
    const insertCall = (admin as any)._jobsInsert.mock.calls[0][0];
    expect(insertCall).toHaveLength(2);
    expect(insertCall[0].payload.connectedAccountId).toBe(mockAccountId1);
    expect(insertCall[1].payload.connectedAccountId).toBe(mockAccountId2);
    expect(res.body.data.accountCount).toBe(2);
  });

  it('creates variant_posts when experimentId and variantId provided', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
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
      {
        id: mockAccountId2,
        workspace_id: mockWorkspaceId,
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-2',
        display_name: 'Channel 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const attachClipSpy = vi.spyOn(experimentService, 'attachClipToExperimentVariant').mockResolvedValue(undefined);
    const createVariantPostsSpy = vi.spyOn(orchestrationService, 'createVariantPostsForClip').mockResolvedValue(undefined);

    const experimentId = '423e4567-e89b-12d3-a456-426614174000';
    const variantId = '523e4567-e89b-12d3-a456-426614174000';

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        connectedAccountIds: [mockAccountId1, mockAccountId2],
        experimentId,
        variantId,
      });

    expect(res.status).toBe(200);
    expect(attachClipSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockWorkspaceId,
        clipId: mockClipId,
        experimentId,
        variantId,
      }),
      expect.any(Object),
    );
    expect(createVariantPostsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockWorkspaceId,
        clipId: mockClipId,
        experimentId,
        variantId,
        platform: 'youtube_shorts',
        connectedAccountIds: [mockAccountId1, mockAccountId2],
      }),
      expect.any(Object),
    );
  });

  it('uses default accounts when connectedAccountIds not provided', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
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

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        // No connectedAccountIds - should use defaults
      });

    expect(res.status).toBe(200);
    expect(connectedAccountsService.getConnectedAccountsForPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockWorkspaceId,
        platform: 'youtube',
        connectedAccountIds: undefined,
      }),
      expect.any(Object),
    );
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    // Mock rate limiting to return not allowed
    vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
      allowed: false,
      remaining: 0,
    });

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
      });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('too_many_requests');

    // Verify no job was enqueued
    expect((admin as any)._jobsInsert).not.toHaveBeenCalled();
  });

  it('rejects account IDs from different workspace', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const otherWorkspaceAccountId = '99999999-9999-4999-8999-999999999999';

    // Mock getConnectedAccountsForPublish to throw error when account doesn't belong to workspace
    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockRejectedValue(
      new Error(`Some connected accounts not found or inactive: ${otherWorkspaceAccountId}`),
    );

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        connectedAccountIds: [otherWorkspaceAccountId],
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('invalid_request');
    expect(res.body.message).toContain('not found or inactive');

    // Verify no job was enqueued
    expect((admin as any)._jobsInsert).not.toHaveBeenCalled();
  });

  it('rejects account IDs with wrong platform', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const tiktokAccountId = '88888888-8888-4888-8888-888888888888';

    // Mock getConnectedAccountsForPublish to return empty array (account exists but wrong platform)
    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockRejectedValue(
      new Error(`Some connected accounts not found or inactive: ${tiktokAccountId}`),
    );

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        connectedAccountIds: [tiktokAccountId],
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('invalid_request');

    // Verify no job was enqueued
    expect((admin as any)._jobsInsert).not.toHaveBeenCalled();
  });

  it('only uses accounts from current workspace for default selection', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    // Mock getConnectedAccountsForPublish to return only accounts from current workspace
    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId, // Same workspace
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

    const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        visibility: 'public',
        // No connectedAccountIds - should use defaults
      });

    expect(res.status).toBe(200);
    // Verify getConnectedAccountsForPublish was called with correct workspace
    expect(connectedAccountsService.getConnectedAccountsForPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockWorkspaceId,
        platform: 'youtube',
      }),
      expect.any(Object),
    );
    // Verify only accounts from current workspace were used
    const insertCall = (admin as any)._jobsInsert.mock.calls[0][0];
    expect(insertCall[0].payload.connectedAccountId).toBe(mockAccountId1);
  });

  describe('Request validation', () => {
    it('returns 400 when clipId is missing', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          visibility: 'public',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code || res.body.error?.code).toBe('invalid_request');
    });

    it('returns 400 when clipId is not a valid UUID', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: 'not-a-uuid',
          visibility: 'public',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 400 when visibility is invalid', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'invalid-visibility',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 400 when descriptionOverride exceeds max length', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const longDescription = 'a'.repeat(5001); // Exceeds 5000 char limit

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
          descriptionOverride: longDescription,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('Security headers', () => {
    it('returns security headers in response', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
        {
          id: mockAccountId1,
          workspace_id: mockWorkspaceId,
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

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          visibility: 'public',
        });

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('handles OPTIONS preflight request', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute), 'options')
        .options('/')
        .set({
          ...commonHeaders,
          origin: 'http://localhost:3000',
        });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });
  });
});
