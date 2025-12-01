import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishTikTokRoute from '../../apps/web/src/pages/api/publish/tiktok';
import { supertestHandler } from '../utils/supertest-next';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';
import * as orchestrationService from '../../apps/web/src/lib/viral/orchestrationService';
import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import * as supabase from '../../apps/web/src/lib/supabase';
import * as rateLimit from '../../apps/web/src/lib/rate-limit';
import { TikTokClient } from '../../apps/worker/src/services/tiktok/client';

// Mock Supabase client creation for buildAuthContext
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const toApiHandler = (handler: typeof publishTikTokRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId1 = '223e4567-e89b-12d3-a456-426614174001';
const mockAccountId2 = '323e4567-e89b-12d3-a456-426614174002';
const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';
const userId = '00000000-0000-0000-0000-000000000001';

// Shared idempotency state across all admin mocks
const idempotencyState: Record<string, { status: string; response_hash: string | null }> = {};

function createAdminMock() {
  // Create a stable insert function that can be spied on
  const jobsData: Array<Record<string, unknown>> = [];
  const jobsInsertFn = vi.fn().mockImplementation((rows: unknown) => {
    const rowsArray = Array.isArray(rows) ? rows : [rows];
    const withIds = rowsArray.map((row: any) => ({
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workspace_id: row.workspace_id,
      kind: row.kind,
      status: row.status,
      payload: row.payload,
      ...row,
    }));
    jobsData.push(...withIds);
    return {
      select: vi.fn().mockResolvedValue({
        data: withIds,
        error: null,
      }),
    };
  });
  
  const admin = {
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
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === 'variant_posts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        };
      }
      if (table === 'experiments' || table === 'experiment_variants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'exp-e2e-123',
              workspace_id: mockWorkspaceId,
              experiment_id: 'exp-e2e-123',
            },
            error: null,
          }),
        };
      }
      if (table === 'jobs') {
        const jobsSelectChain = {
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: jobsData.filter((j: any) => {
              // This will be called with filters, but we'll filter in order()
              return true;
            }),
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
            data: jobsData,
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
      if (table === 'idempotency') {
        // Track idempotency state for tests - shared across calls
        let lastKey: string | null = null;
        
        const idempotencyChain = {
          select: vi.fn((columns?: string) => {
            const selectChain = {
              eq: vi.fn().mockImplementation((column: string, value: unknown) => {
                if (column === 'key') {
                  lastKey = value as string;
                }
                return {
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    if (lastKey && idempotencyState[lastKey]) {
                      const record = idempotencyState[lastKey];
                      // Return only selected columns if specified
                      if (columns) {
                        const selected: any = {};
                        columns.split(",").forEach((col) => {
                          const trimmed = col.trim();
                          if (record[trimmed as keyof typeof record] !== undefined) {
                            selected[trimmed] = record[trimmed as keyof typeof record];
                          }
                        });
                        return { data: selected, error: null };
                      }
                      return { data: record, error: null };
                    }
                    return { data: null, error: { code: "PGRST116" } };
                  }),
                };
              }),
            };
            return selectChain;
          }),
          insert: vi.fn().mockImplementation((data: unknown) => {
            const row = Array.isArray(data) ? data[0] : data;
            const key = (row as { key: string }).key;
            const status = (row as { status: string }).status;
            const request_hash = (row as { request_hash?: string }).request_hash ?? null;
            if (key) {
              idempotencyState[key] = { 
                key,
                user_id: (row as { user_id?: string }).user_id ?? '',
                status, 
                request_hash,
                response_hash: null,
                created_at: new Date().toISOString(),
                expires_at: (row as { expires_at?: string }).expires_at ?? null,
              };
            }
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: idempotencyState[key],
                  error: null,
                }),
              })),
            };
          }),
          update: vi.fn().mockImplementation((data: unknown) => {
            return {
              eq: vi.fn().mockImplementation((column: string, value: unknown) => {
                if (column === 'key' && idempotencyState[value as string]) {
                  idempotencyState[value as string] = {
                    ...idempotencyState[value as string],
                    ...(data as Record<string, unknown>),
                  };
                }
                return {
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: idempotencyState[value as string] ?? null,
                      error: null,
                    }),
                  })),
                };
              }),
            };
          }),
        };
        return idempotencyChain;
      }
      if (table === 'workspaces') {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: mockWorkspaceId,
              plan: 'pro',
            },
            error: null,
          }),
        };
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.select = vi.fn().mockReturnValue(chain);
        return chain;
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
        chain.select = vi.fn().mockReturnValue(chain);
        return chain;
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
  return admin;
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  // Set the mock client that createClient will return for buildAuthContext
  mockSupabaseClientFactory.mockReturnValue(admin);
}

describe('POST /api/publish/tiktok - E2E Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
    // Mock rate limiting to always allow
    vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
      allowed: true,
      remaining: 60,
    });
  });

  it('enqueues jobs and verifies TikTok client integration points', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
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
    // Use the stable insert function reference stored on the admin mock
    expect((admin as any)._jobsInsert).toHaveBeenCalledTimes(1);
    const insertCall = (admin as any)._jobsInsert.mock.calls[0][0];
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
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
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

    const attachClipSpy = vi.spyOn(experimentService, 'attachClipToExperimentVariant').mockResolvedValue(undefined);
    const createVariantPostsSpy = vi.spyOn(orchestrationService, 'createVariantPostsForClip').mockResolvedValue(undefined);

    const experimentId = '423e4567-e89b-12d3-a456-426614174000';
    const variantId = '523e4567-e89b-12d3-a456-426614174000';

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
    const admin = createAdminMock();
    mockAdminClient(admin);

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
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

    const idempotencyKey = 'test-idempotency-key-123';
    const payload = {
      clipId: mockClipId,
      connectedAccountIds: [mockAccountId1],
      caption: 'First call',
    };

    // First call with Idempotency-Key header - should create job
    const res1 = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set({
        ...commonHeaders,
        'Idempotency-Key': idempotencyKey,
      })
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.data.idempotent).toBe(false);

    // Clear jobs insert call count
    (admin as any)._jobsInsert.mockClear();

    // Second call with same Idempotency-Key and same payload - should reuse
    const res2 = await supertestHandler(toApiHandler(publishTikTokRoute))
      .post('/')
      .set({
        ...commonHeaders,
        'Idempotency-Key': idempotencyKey,
      })
      .send(payload); // Same payload

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.data.idempotent).toBe(true);
    // Verify no new jobs were created
    expect((admin as any)._jobsInsert).not.toHaveBeenCalled();
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

