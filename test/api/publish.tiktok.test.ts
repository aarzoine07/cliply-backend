import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishTikTokRoute from '../../apps/web/src/pages/api/publish/tiktok';
import { supertestHandler } from '../utils/supertest-next';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';
import * as orchestrationService from '../../apps/web/src/lib/viral/orchestrationService';
import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import * as supabase from '../../apps/web/src/lib/supabase';

const toApiHandler = (handler: typeof publishTikTokRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId1 = '223e4567-e89b-12d3-a456-426614174001';
const mockAccountId2 = '323e4567-e89b-12d3-a456-426614174002';
const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';

// Use UUID-shaped IDs for experiment/variant to satisfy Zod UUID schemas
const mockExperimentId = '423e4567-e89b-12d3-a456-426614174003';
const mockVariantId = '523e4567-e89b-12d3-a456-426614174004';

function createAdminClient() {
  const clipsTable = {
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

  const jobsTable = {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'job-123' }],
        error: null,
      }),
    }),
  };

  const idempotencyTable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // Simulate "no existing row" with PostgREST 116 code
    maybeSingle: vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    }),
    upsert: vi.fn().mockResolvedValue({
      data: null,
      error: null,
    }),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'clips') {
        return clipsTable;
      }
      if (table === 'jobs') {
        return jobsTable;
      }
      if (table === 'idempotency') {
        return idempotencyTable;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        upsert: vi.fn(),
      };
    }),
  };
}

function mockAdminClient(admin: ReturnType<typeof createAdminClient>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
}

describe('POST /api/publish/tiktok', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({ clipId: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when neither connectedAccountId nor connectedAccountIds provided', async () => {
    const admin = createAdminClient();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when clip not found', async () => {
    const admin = createAdminClient();
    // Override default clip to simulate "not found"
    (admin.from('clips') as any).maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    mockAdminClient(admin);

    // Return at least one account so we hit the "clip not found" path,
    // not the "no accounts" path.
    vi.spyOn(
      connectedAccountsService,
      'getConnectedAccountsForPublish',
    ).mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-1',
        display_name: 'TikTok Account 1',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountId: mockAccountId1,
      });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('enqueues single PUBLISH_TIKTOK job for single account (backward compatibility)', async () => {
    const admin = createAdminClient();
    mockAdminClient(admin);

    vi.spyOn(
      connectedAccountsService,
      'getConnectedAccountsForPublish',
    ).mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-1',
        display_name: 'TikTok Account 1',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountId: mockAccountId1,
        caption: 'Test caption',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(admin.from('jobs').insert).toHaveBeenCalledTimes(1);
    const insertCall = (admin.from('jobs').insert as any).mock.calls[0][0];
    expect(insertCall).toHaveLength(1);
    expect(insertCall[0].payload.connectedAccountId).toBe(
      mockAccountId1,
    );
  });

  it('enqueues multiple PUBLISH_TIKTOK jobs for multiple accounts', async () => {
    const admin = createAdminClient();
    mockAdminClient(admin);

    vi.spyOn(
      connectedAccountsService,
      'getConnectedAccountsForPublish',
    ).mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-1',
        display_name: 'TikTok Account 1',
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
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-2',
        display_name: 'TikTok Account 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountIds: [mockAccountId1, mockAccountId2],
        caption: 'Test caption',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(admin.from('jobs').insert).toHaveBeenCalledTimes(1);
    const insertCall = (admin.from('jobs').insert as any).mock.calls[0][0];
    expect(insertCall).toHaveLength(2);
    expect(insertCall[0].payload.connectedAccountId).toBe(
      mockAccountId1,
    );
    expect(insertCall[1].payload.connectedAccountId).toBe(
      mockAccountId2,
    );

    // Response shape: accountCount is top-level on the body
    expect(res.body.data.accountCount).toBe(2);
  });

  it('creates variant_posts when experimentId and variantId provided', async () => {
    const admin = createAdminClient();
    mockAdminClient(admin);

    vi.spyOn(
      connectedAccountsService,
      'getConnectedAccountsForPublish',
    ).mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-1',
        display_name: 'TikTok Account 1',
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
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-2',
        display_name: 'TikTok Account 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const attachClipSpy = vi
      .spyOn(experimentService, 'attachClipToExperimentVariant')
      .mockResolvedValue(undefined);
    const createVariantPostsSpy = vi
      .spyOn(orchestrationService, 'createVariantPostsForClip')
      .mockResolvedValue(undefined);

    const experimentId = mockExperimentId;
    const variantId = mockVariantId;

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountIds: [mockAccountId1, mockAccountId2],
        caption: 'Test caption',
        experimentId,
        variantId,
      });

    // If this ever fails again, uncomment this for deeper debug:
    // // eslint-disable-next-line no-console
    // console.log(
    //   'DEBUG publish.tiktok variant test response:',
    //   res.status,
    //   JSON.stringify(res.body, null, 2),
    // );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

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
        platform: 'tiktok',
        connectedAccountIds: [mockAccountId1, mockAccountId2],
      }),
      expect.any(Object),
    );
  });

  it('uses default accounts when connectedAccountIds not provided', async () => {
    const admin = createAdminClient();
    mockAdminClient(admin);

    vi.spyOn(
      connectedAccountsService,
      'getConnectedAccountsForPublish',
    ).mockResolvedValue([
      {
        id: mockAccountId1,
        workspace_id: mockWorkspaceId,
        platform: 'tiktok',
        provider: 'tiktok',
        external_id: 'tiktok-1',
        display_name: 'TikTok Account 1',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountId: mockAccountId1,
        // No connectedAccountIds - should use single account
      });

    expect(res.status).toBe(200);
    expect(
      connectedAccountsService.getConnectedAccountsForPublish,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockWorkspaceId,
        platform: 'tiktok',
        connectedAccountIds: [mockAccountId1],
      }),
      expect.any(Object),
    );
  });
});


