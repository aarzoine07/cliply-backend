import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageTracker from '../../packages/shared/src/billing/usageTracker';
import * as storage from '../../apps/web/src/lib/storage';
import * as supabaseAdmin from '../../apps/web/src/lib/supabase';
import uploadInit from '../../apps/web/src/pages/api/upload/init';
import { supertestHandler } from '../utils/supertest-next';

// Mock Supabase createClient (used by RLS/auth context construction)
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const toApiHandler = (handler: typeof uploadInit) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

// IMPORTANT: upload/init expects an auth-style header.
// Keep x-debug-* AND Authorization.
const commonHeaders: Record<string, string> = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
  authorization: 'Bearer test-access-token',
};

type SupabaseMock = {
  inserted: Array<Record<string, any>>;
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
};

let _uuidCounter = 1;
function nextUuid(): string {
  const tail = String(_uuidCounter++).padStart(12, '0');
  return `00000000-0000-0000-0000-${tail}`;
}

function makeInsertResult<T>(data: T) {
  // Supabase-js queries are thenables; some code awaits the builder directly.
  const result: any = {
    data,
    error: null,
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
    catch: (reject: any) => Promise.resolve({ data, error: null }).catch(reject),
  };
  return result;
}

function createSupabaseMock(): SupabaseMock {
  const inserted: Array<Record<string, any>> = [];

  const chain = () => {
    const c: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };
    return c;
  };

  const mock: SupabaseMock = {
    inserted,
    rpc: vi.fn().mockResolvedValue({ data: 10, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: commonHeaders['x-debug-user'] } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      // membership lookup (auth context / workspace resolution)
      if (table === 'workspace_members') {
        const c = chain();
        c.maybeSingle.mockResolvedValue({
          data: { workspace_id: commonHeaders['x-debug-workspace'] },
          error: null,
        });
        return c;
      }

      // plan resolution (safe default: no subscription -> basic/default)
      if (table === 'subscriptions') {
        const c = chain();
        c.maybeSingle.mockResolvedValue({ data: null, error: null });
        return c;
      }

      // upload/init inserts project via RLS client
      if (table === 'projects') {
        return {
          insert: (payload: Record<string, any> | Array<Record<string, any>>) => {
            const row = Array.isArray(payload)
              ? { id: nextUuid(), ...(payload[0] ?? {}) }
              : { id: nextUuid(), ...payload };

            inserted.push(row);
            return makeInsertResult(row);
          },
        };
      }

      // upload/init enqueues job via RLS client
      if (table === 'jobs') {
        return {
          insert: (payload: Record<string, any> | Array<Record<string, any>>) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            rows.forEach((r) => inserted.push(r));
            return makeInsertResult(rows);
          },
        };
      }

      // safe default
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };

  return mock;
}

function mockClients(client: SupabaseMock) {
  // If the route calls admin client anywhere, point it at the same object.
  vi.spyOn(supabaseAdmin, 'getAdminClient').mockReturnValue(client as never);

  // RLS/auth client
  mockSupabaseClientFactory.mockReturnValue(client as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockSupabaseClientFactory.mockClear();
  _uuidCounter = 1;
});

describe('POST /api/upload/init', () => {
  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(uploadInit)).post('/').send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('file mode: returns signed upload info', async () => {
    const client = createSupabaseMock();
    mockClients(client);

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

    expect(usageTracker.assertWithinUsage).toHaveBeenCalled();
    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: commonHeaders['x-debug-workspace'],
        metric: 'projects',
        amount: 1,
      }),
    );
  });

  it('youtube mode: returns project id and enqueues download job', async () => {
    const client = createSupabaseMock();
    mockClients(client);

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

    const jobsInserted = client.inserted.filter((item) => item.kind === 'YOUTUBE_DOWNLOAD');
    expect(jobsInserted.length).toBe(1);
    expect(jobsInserted[0]).toMatchObject({
      kind: 'YOUTUBE_DOWNLOAD',
      status: 'queued',
      payload: {
        projectId: res.body.projectId,
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    expect(usageTracker.assertWithinUsage).toHaveBeenCalled();
    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: commonHeaders['x-debug-workspace'],
        metric: 'projects',
        amount: 1,
      }),
    );
  });

  it('file mode: returns 429 when usage limit exceeded', async () => {
    const client = createSupabaseMock();
    mockClients(client);

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
        size: 1024 * 1024 * 10,
        mime: 'video/mp4',
      });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('usage_limit_exceeded');
    expect(res.body.error.metric).toBe('source_minutes');

    const projectsInserted = client.inserted.filter((item) => item.id);
    expect(projectsInserted.length).toBe(0);
  });

  it('youtube mode: returns 429 when usage limit exceeded', async () => {
    const client = createSupabaseMock();
    mockClients(client);

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

    const projectsInserted = client.inserted.filter((item) => item.id);
    expect(projectsInserted.length).toBe(0);
  });

  it('invalid payload -> 400', async () => {
    const client = createSupabaseMock();
    mockClients(client);

    const res = await supertestHandler(toApiHandler(uploadInit))
      .post('/')
      .set(commonHeaders)
      .send({ source: 'file' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});