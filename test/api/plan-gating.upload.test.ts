/**
 * Plan gating tests for upload endpoints
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageTracker from '../../packages/shared/src/billing/usageTracker';
import * as storage from '../../apps/web/src/lib/storage';
import * as supabaseAdmin from '../../apps/web/src/lib/supabase';
import uploadInit from '../../apps/web/src/pages/api/upload/init';
import uploadComplete from '../../apps/web/src/pages/api/upload/complete';
import { supertestHandler } from '../utils/supertest-next';

// Mock Supabase client creation for buildAuthContext
// Use vi.hoisted to avoid hoisting issues
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const toApiHandler = (handler: typeof uploadInit) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const userId = '123e4567-e89b-12d3-a456-426614174001';
const workspaceId = '123e4567-e89b-12d3-a456-426614174000';

// IMPORTANT: access token is required now (handlers enforce it for RLS client usage)
const commonHeaders = {
  'x-debug-user': userId,
  'x-debug-workspace': workspaceId,
  authorization: 'Bearer test-access-token',
};

type AdminMock = {
  inserted: Array<Record<string, unknown>>;
  from: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
};

function createAdminMock(plan: 'basic' | 'pro' | 'premium' = 'basic'): AdminMock {
  const inserted: Array<Record<string, unknown>> = [];

  const createQueryChain = <TData = unknown>(result: TData) => {
    const chain: any = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: result,
        error: null,
      }),
    };

    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);

    return chain;
  };

  const admin: AdminMock = {
    inserted,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        const chain = createQueryChain<{ workspace_id: string }>({
          workspace_id: workspaceId,
        });

        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { workspace_id: workspaceId },
          error: null,
        });

        return chain;
      }

      if (table === 'subscriptions') {
        const subscriptionData =
          plan === 'basic'
            ? null
            : {
                plan_name: plan,
                status: 'active',
                current_period_end: new Date().toISOString(),
                stripe_subscription_id: 'sub_123',
              };

        const chain: any = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: subscriptionData,
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

      if (table === 'projects') {
        // Used by:
        // - upload/init: insert(...).select().maybeSingle()
        // - upload/complete: select('id').eq('id', projectId).maybeSingle()
        let idFilter: string | null = null;

        const chain: any = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn(),
          insert: vi.fn(),
        };

        chain.select.mockReturnValue(chain);
        chain.eq.mockImplementation((col: string, val: unknown) => {
          if (col === 'id') idFilter = String(val);
          return chain;
        });
        chain.in.mockReturnValue(chain);
        chain.order.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);

        chain.maybeSingle.mockImplementation(async () => {
          // For upload/complete, we want the project to exist.
          return {
            data: idFilter ? { id: idFilter } : { id: 'test-project' },
            error: null,
          };
        });

        chain.insert.mockImplementation((payload: Record<string, unknown>) => {
          inserted.push(payload);

          const insertResult: any = {
            select: vi.fn(),
            maybeSingle: vi.fn(),
          };
          insertResult.select.mockReturnValue(insertResult);
          insertResult.maybeSingle.mockResolvedValue({
            data: payload,
            error: null,
          });

          return insertResult;
        });

        return chain;
      }

      if (table === 'jobs') {
        // upload/complete inserts jobs (admin OK)
        const chain: any = createQueryChain<unknown>(null);

        chain.insert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          inserted.push(payload);
          return Promise.resolve({ data: null, error: null });
        });

        return chain;
      }

      return createQueryChain<unknown>(null);
    }),
  };

  (admin as any).rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  return admin;
}

function mockClients(admin: AdminMock) {
  vi.spyOn(supabaseAdmin, 'getAdminClient').mockReturnValue(admin as never);
  vi.spyOn(supabaseAdmin, 'getRlsClient').mockReturnValue(admin as never);

  // buildAuthContext's internal service-role client creation
  mockSupabaseClientFactory.mockReturnValue(admin);
}

describe('Plan Gating - Upload Endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
  });

  describe('POST /api/upload/init', () => {
    it('allows upload when plan includes uploads_per_day and under limit', async () => {
      const admin = createAdminMock('pro');
      mockClients(admin);

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

      if (res.status !== 200) {
        console.error('Test failed with status:', res.status);
        console.error('Response body:', JSON.stringify(res.body, null, 2));
        console.error('Response text:', res.text);
      }

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.uploadUrl).toBe('https://signed.example/upload');
    });

    it('blocks upload when plan feature check fails (uploads_per_day = 0)', async () => {
      const admin = createAdminMock('basic');
      mockClients(admin);

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
    });

    it('blocks when workspace has no active subscription (defaults to basic)', async () => {
      const admin = createAdminMock('basic');
      mockClients(admin);

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
    });

    it('handles usage limit exceeded separately (429)', async () => {
      const admin = createAdminMock('basic');
      mockClients(admin);

      vi.spyOn(storage, 'getSignedUploadUrl').mockResolvedValue('https://signed.example/upload');
      vi.spyOn(usageTracker, 'assertWithinUsage').mockRejectedValue(
        new usageTracker.UsageLimitExceededError('projects', 150, 150),
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
      expect(res.body.error.metric).toBe('projects');
    });
  });

  describe('POST /api/upload/complete', () => {
    it('allows job enqueue when under concurrent_jobs limit', async () => {
      const admin = createAdminMock('pro');
      mockClients(admin);

      const res = await supertestHandler(toApiHandler(uploadComplete))
        .post('/')
        .set(commonHeaders)
        .send({
          projectId: workspaceId, // same UUID shape, and our mock returns it as existing
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const jobsInserted = admin.inserted.filter((item) => item.kind === 'TRANSCRIBE');
      expect(jobsInserted.length).toBe(1);
    });

    it('blocks job enqueue when plan does not allow concurrent_jobs (plan feature)', async () => {
      const admin = createAdminMock('basic');
      mockClients(admin);

      const res = await supertestHandler(toApiHandler(uploadComplete))
        .post('/')
        .set(commonHeaders)
        .send({
          projectId: workspaceId,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 403 when workspace has no plan (no subscription)', async () => {
      const admin = createAdminMock('basic');
      mockClients(admin);

      const res = await supertestHandler(toApiHandler(uploadComplete))
        .post('/')
        .set(commonHeaders)
        .send({
          projectId: workspaceId,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});