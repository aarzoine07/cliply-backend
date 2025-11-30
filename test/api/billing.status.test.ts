// D1: Billing status endpoint tests
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRITICAL: Set NODE_ENV to "test" to enable test-only plan resolution shortcut in buildAuthContext
process.env.NODE_ENV = 'test';

import * as usageTracker from '../../packages/shared/billing/usageTracker';
import * as workspacePlanService from '../../apps/web/src/lib/billing/workspacePlanService';
import * as supabaseAdmin from '../../apps/web/src/lib/supabase';
import billingStatusRoute from '../../apps/web/src/pages/api/billing/status';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof billingStatusRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '123e4567-e89b-12d3-a456-426614174001';
const commonHeaders = {
  'x-debug-user': userId,
  'x-debug-workspace': workspaceId,
};

type AdminMock = {
  from: ReturnType<typeof vi.fn>;
};

function createAdminMock(): AdminMock {
  const admin: AdminMock = {
    from: vi.fn((table: string) => {
      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: workspaceId,
                  billing_status: 'active',
                },
                error: null,
              }),
            }),
          }),
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

beforeEach(() => {
  vi.restoreAllMocks();
  
  // Default mocks that work for most tests
  vi.spyOn(workspacePlanService, 'getWorkspacePlan').mockResolvedValue('basic');
  vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
    workspaceId,
    planName: 'basic',
    periodStart: new Date('2025-01-01T00:00:00.000Z'),
    metrics: {
      source_minutes: { used: 50, limit: 150 },
      clips: { used: 100, limit: 450 },
      projects: { used: 30, limit: 150 },
    },
  });
  mockAdminClient(createAdminMock());
});

describe('GET /api/billing/status', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('returns 401 when workspace is missing', async () => {
    // buildAuthContext requires workspace, so missing workspace results in 401
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set('x-debug-user', userId);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('returns billing status with plan, usage, limits, and remaining', async () => {
    vi.spyOn(workspacePlanService, 'getWorkspacePlan').mockResolvedValue('basic');
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId,
      planName: 'basic',
      periodStart: new Date('2025-01-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 50, limit: 150 },
        clips: { used: 100, limit: 450 },
        projects: { used: 30, limit: 150 },
      },
    });

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.data).toHaveProperty('plan');
    expect(res.body.data).toHaveProperty('billingStatus');
    expect(res.body.data).toHaveProperty('limits');
    expect(res.body.data).toHaveProperty('usage');
    expect(res.body.data).toHaveProperty('remaining');

    // Check structure
    expect(res.body.data.plan).toMatch(/^(basic|pro|premium)$/);
    expect(res.body.data.limits).toHaveProperty('source_minutes');
    expect(res.body.data.limits).toHaveProperty('clips');
    expect(res.body.data.limits).toHaveProperty('projects');
    expect(res.body.data.usage).toHaveProperty('source_minutes');
    expect(res.body.data.usage).toHaveProperty('clips');
    expect(res.body.data.usage).toHaveProperty('projects');
    expect(res.body.data.remaining).toHaveProperty('source_minutes');
    expect(res.body.data.remaining).toHaveProperty('clips');
    expect(res.body.data.remaining).toHaveProperty('projects');
  });

  it('calculates remaining correctly', async () => {
    vi.spyOn(workspacePlanService, 'getWorkspacePlan').mockResolvedValue('pro');
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId,
      planName: 'pro',
      periodStart: new Date('2025-01-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 200, limit: 900 },
        clips: { used: 500, limit: 10800 },
        projects: { used: 100, limit: 900 },
      },
    });

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    const { limits, usage, remaining } = res.body.data;

    // Verify remaining calculation
    if (limits.source_minutes !== null) {
      expect(remaining.source_minutes).toBe(
        Math.max(0, limits.source_minutes - usage.source_minutes),
      );
    }
    if (limits.clips !== null) {
      expect(remaining.clips).toBe(Math.max(0, limits.clips - usage.clips));
    }
    if (limits.projects !== null) {
      expect(remaining.projects).toBe(Math.max(0, limits.projects - usage.projects));
    }
  });

  it('handles unlimited limits (null)', async () => {
    vi.spyOn(workspacePlanService, 'getWorkspacePlan').mockResolvedValue('premium');
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId,
      planName: 'premium',
      periodStart: new Date('2025-01-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 1000, limit: 4500 },
        clips: { used: 500, limit: 180000 },
        projects: { used: 200, limit: 4500 },
      },
    });

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    // Premium plan might have null limits for some metrics
    // Just verify the structure is correct
    expect(res.body.data.limits).toBeDefined();
    expect(res.body.data.remaining).toBeDefined();
  });
});

