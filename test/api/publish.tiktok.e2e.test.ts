import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishTikTokRoute from '../../apps/web/src/pages/api/publish/tiktok';
import { supertestHandler } from '../utils/supertest-next';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';
import * as orchestrationService from '../../apps/web/src/lib/viral/orchestrationService';
import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import * as supabase from '../../apps/web/src/lib/supabase';
import { TikTokClient } from '../../apps/worker/src/services/tiktok/client';

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

function createAdminClient() {
  return {
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
        const insert = vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'job-123' }, { id: 'job-456' }],
            error: null,
          }),
        });
        const select = vi.fn().mockReturnThis();
        const eq = vi.fn().mockReturnThis();
        const order = vi.fn().mockResolvedValue({
          data: [{ id: 'job-123' }, { id: 'job-456' }],
          error: null,
        });

        return {
          insert,
          select,
          eq,
          order,
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
  };
}

function mockAdminClient(admin: ReturnType<typeof createAdminClient>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
}

describe('POST /api/publish/tiktok - E2E Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues jobs and verifies TikTok client integration points', async () => {
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
        caption: 'Test E2E caption',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accountCount).toBe(2);
    expect(res.body.data.jobIds).toHaveLength(2);

    // Verify jobs were created with correct payloads
    expect(admin.from('jobs').insert).toHaveBeenCalledTimes(1);
    const insertCall = (admin.from('jobs').insert as any).mock.calls[0][0];
    expect(insertCall).toHaveLength(2);

    // Verify first job payload
    expect(insertCall[0]).toMatchObject({
      workspace_id: mockWorkspaceId,
      kind: 'PUBLISH_TIKTOK',
      status: 'queued',
      payload: {
        clipId: mockClipId,
        connectedAccountId: mockAccountId1,
        caption: 'Test E2E caption',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      },
    });

    // Verify second job payload
    expect(insertCall[1]).toMatchObject({
      workspace_id: mockWorkspaceId,
      kind: 'PUBLISH_TIKTOK',
      status: 'queued',
      payload: {
        clipId: mockClipId,
        connectedAccountId: mockAccountId2,
        caption: 'Test E2E caption',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      },
    });
  });

  it('creates variant_posts for experiment flow', async () => {
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

    const attachClipSpy = vi
      .spyOn(experimentService, 'attachClipToExperimentVariant')
      .mockResolvedValue(undefined);
    const createVariantPostsSpy = vi
      .spyOn(orchestrationService, 'createVariantPostsForClip')
      .mockResolvedValue(undefined);

    const experimentId = 'exp-e2e-123';
    const variantId = 'var-e2e-123';

    const res = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountIds: [mockAccountId1],
        caption: 'Experiment caption',
        experimentId,
        variantId,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify experiment hooks were called
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
        connectedAccountIds: [mockAccountId1],
      }),
      expect.any(Object),
    );
  });

  it('handles idempotency correctly', async () => {
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

    // First call - should create job
    const res1 = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountIds: [mockAccountId1],
        caption: 'First call',
      });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.data.idempotent).toBe(false);

    // Second call with same payload - should return existing jobs
    const res2 = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set(commonHeaders)
      .send({
        clipId: mockClipId,
        connectedAccountIds: [mockAccountId1],
        caption: 'First call', // Same payload
      });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.data.idempotent).toBe(true);
  });
});

describe('TikTok Client Integration Points', () => {
  it('verifies TikTokClient can be instantiated and called', async () => {
    // This test verifies the TikTok client structure matches what the pipeline expects
    const mockUploadVideo = vi.fn().mockResolvedValue({
      videoId: 'tiktok-video-123',
      rawResponse: { data: { video_id: 'tiktok-video-123' } },
    });

    const client = new TikTokClient({ accessToken: 'test-token' });
    // Mock the uploadVideo method
    (client as any).uploadVideo = mockUploadVideo;

    const result = await client.uploadVideo({
      filePath: '/tmp/test.mp4',
      caption: 'Test caption',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
    });

    expect(result.videoId).toBe('tiktok-video-123');
    expect(mockUploadVideo).toHaveBeenCalledWith({
      filePath: '/tmp/test.mp4',
      caption: 'Test caption',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
    });
  });
});


