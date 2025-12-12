import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageTracker from '@cliply/shared/billing/usageTracker';
import * as storage from '../../apps/web/src/lib/storage';
import * as supabaseAdmin from '../../apps/web/src/lib/supabase';
import uploadInit from '../../apps/web/src/pages/api/upload/init';
import { supertestHandler } from '../utils/supertest-next';

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

type AdminMock = {
  inserted: Array<Record<string, unknown>>;
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

const toApiHandler = (handler: typeof uploadInit) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/upload/init', () => {
  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(uploadInit)).post('/').send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('file mode: returns signed upload info', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);
    vi.spyOn(storage, 'getSignedUploadUrl').mockResolvedValue('https://signed.example/upload');
    vi.spyOn(usageTracker, 'assertWithinUsage').mockResolvedValue(undefined);
    vi.spyOn(usageTracker, 'recordUsage').mockResolvedValue(undefined);

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({
        source: 'file',
        filename: 'demo.mp4',
        size: 1024,
        mime: 'video/mp4',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.uploadUrl).toBe('https://signed.example/upload');
    expect(res.body.storagePath).toMatch(/^videos\//);
    expect(res.body.projectId).toMatch(/[0-9a-f\-]{36}/i);

    // Verify usage was checked and recorded
    expect(usageTracker.assertWithinUsage).toHaveBeenCalled();
    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '11111111-1111-1111-1111-111111111111',
        metric: 'projects',
        amount: 1,
      }),
    );
  });

  it('youtube mode: returns project id and enqueues download job', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);
    vi.spyOn(usageTracker, 'assertWithinUsage').mockResolvedValue(undefined);
    vi.spyOn(usageTracker, 'recordUsage').mockResolvedValue(undefined);

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({
        source: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectId).toMatch(/[0-9a-f\-]{36}/i);

    // Verify that a YouTube download job was enqueued
    const jobsInserted = admin.inserted.filter(
      (item) => item.kind === 'YOUTUBE_DOWNLOAD',
    );
    expect(jobsInserted.length).toBe(1);
    expect(jobsInserted[0]).toMatchObject({
      kind: 'YOUTUBE_DOWNLOAD',
      status: 'queued',
      payload: {
        projectId: res.body.projectId,
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Verify usage was checked and recorded
    expect(usageTracker.assertWithinUsage).toHaveBeenCalled();
    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '11111111-1111-1111-1111-111111111111',
        metric: 'projects',
        amount: 1,
      }),
    );
  });

  it('file mode: returns 429 when usage limit exceeded', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);
    vi.spyOn(storage, 'getSignedUploadUrl').mockResolvedValue('https://signed.example/upload');
    vi.spyOn(usageTracker, 'assertWithinUsage').mockRejectedValue(
      new usageTracker.UsageLimitExceededError('source_minutes', 150, 150),
    );

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({
        source: 'file',
        filename: 'demo.mp4',
        size: 1024 * 1024 * 10, // 10MB
        mime: 'video/mp4',
      });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('usage_limit_exceeded');
    expect(res.body.error.metric).toBe('source_minutes');

    // Verify no project was created
    const projectsInserted = admin.inserted.filter((item) => item.id);
    expect(projectsInserted.length).toBe(0);
  });

  it('youtube mode: returns 429 when usage limit exceeded', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);
    vi.spyOn(usageTracker, 'assertWithinUsage').mockRejectedValue(
      new usageTracker.UsageLimitExceededError('projects', 150, 150),
    );

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({
        source: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('usage_limit_exceeded');
    expect(res.body.error.metric).toBe('projects');

    // Verify no project was created
    const projectsInserted = admin.inserted.filter((item) => item.id);
    expect(projectsInserted.length).toBe(0);
  });

  it('invalid payload -> 400', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);
    vi.spyOn(storage, 'getSignedUploadUrl').mockResolvedValue('https://signed.example/upload');

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({ source: 'file' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

function createAdminMock(): AdminMock {
  const inserted: Array<Record<string, unknown>> = [];

  const admin: AdminMock = {
    inserted,
    rpc: vi.fn().mockResolvedValue({ data: 10, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'projects') {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserted.push(payload);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: payload, error: null }),
              }),
            };
          },
        };
      }

      if (table === 'jobs') {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserted.push(payload);
            return {
              error: null,
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return admin;
}

function mockAdminClient(admin: AdminMock) {
  vi.spyOn(supabaseAdmin, 'getAdminClient').mockReturnValue(admin as never);
}
