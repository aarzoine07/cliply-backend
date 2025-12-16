// D1: Billing usage endpoint tests - usage-only endpoint
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageService from '../../apps/web/src/lib/billing/usageService';
import billingUsageRoute from '../../apps/web/src/pages/api/billing/usage';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof billingUsageRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '123e4567-e89b-12d3-a456-426614174001';
const nonExistentWorkspaceId = '123e4567-e89b-12d3-a456-426614174999';

const commonHeaders = {
  'x-debug-user': userId,
  'x-debug-workspace': workspaceId,
};

// Helper to create a mock BillingStatusSummary
function createMockSummary(
  overrides: Partial<{
    tier: 'basic' | 'pro' | 'premium';
    billingStatus: string | null;
    trialActive: boolean;
    trialEndsAt: string | null;
    minutesUsed: number;
    minutesLimit: number | null;
    clipsUsed: number;
    clipsLimit: number | null;
    projectsUsed: number;
    projectsLimit: number | null;
    postsUsed: number;
    postsLimit: number | null;
  }> = {},
): usageService.BillingStatusSummary {
  const {
    tier = 'basic',
    billingStatus = 'active',
    trialActive = false,
    trialEndsAt = null,
    minutesUsed = 10,
    minutesLimit = 150,
    clipsUsed = 5,
    clipsLimit = 450,
    projectsUsed = 2,
    projectsLimit = 150,
    postsUsed = 0,
    postsLimit = 50,
  } = overrides;

  const computeBucket = (
    used: number,
    limit: number | null,
  ): usageService.UsageBucket => {
    if (limit === null) {
      return { used, limit: null, remaining: null, softLimit: false, hardLimit: false };
    }
    const remaining = Math.max(limit - used, 0);
    const hardLimit = used >= limit;
    const softLimit = !hardLimit && used >= 0.8 * limit;
    return { used, limit, remaining, softLimit, hardLimit };
  };

  return {
    plan: {
      tier,
      billingStatus,
      trial: { active: trialActive, endsAt: trialEndsAt },
    },
    usage: {
      minutes: computeBucket(minutesUsed, minutesLimit),
      clips: computeBucket(clipsUsed, clipsLimit),
      projects: computeBucket(projectsUsed, projectsLimit),
      posts: computeBucket(postsUsed, postsLimit),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/billing/usage', () => {
  // -------------------------------------------------------------------------
  // 1. Unauthorized (401)
  // -------------------------------------------------------------------------
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get').get('/');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code');
  });

  // -------------------------------------------------------------------------
  // 2. Invalid or missing workspace header (400)
  // -------------------------------------------------------------------------
  it('returns 400 when workspace is missing', async () => {
    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set('x-debug-user', userId);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'invalid_request');
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 for invalid workspace header format', async () => {
    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', 'not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  // -------------------------------------------------------------------------
  // 3. Workspace not found (404)
  // -------------------------------------------------------------------------
  it('returns 404 when workspace does not exist', async () => {
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockRejectedValue(
      new Error(`Workspace not found: ${nonExistentWorkspaceId}`),
    );

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', nonExistentWorkspaceId);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'workspace_not_found');
    expect(res.body).toHaveProperty('message', 'Workspace not found');
  });

  // -------------------------------------------------------------------------
  // 4. Success (200) - usage-only structure
  // -------------------------------------------------------------------------
  it('returns 200 with usage-only structure (no plan)', async () => {
    const mockSummary = createMockSummary();
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    // Should NOT have plan at top level (usage-only endpoint)
    expect(res.body.data).not.toHaveProperty('plan');

    // Should NOT have top-level softLimit/hardLimit flags
    expect(res.body.data).not.toHaveProperty('softLimit');
    expect(res.body.data).not.toHaveProperty('hardLimit');

    // Should have usage buckets directly in data
    expect(res.body.data).toHaveProperty('minutes');
    expect(res.body.data).toHaveProperty('clips');
    expect(res.body.data).toHaveProperty('projects');
    expect(res.body.data).toHaveProperty('posts');
  });

  it('returns correct usage bucket structure', async () => {
    const mockSummary = createMockSummary({
      minutesUsed: 50,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);

    // Verify usage bucket structure
    const { minutes } = res.body.data;
    expect(minutes).toHaveProperty('used', 50);
    expect(minutes).toHaveProperty('limit', 150);
    expect(minutes).toHaveProperty('remaining', 100);
    expect(minutes).toHaveProperty('softLimit');
    expect(minutes).toHaveProperty('hardLimit');
    expect(typeof minutes.softLimit).toBe('boolean');
    expect(typeof minutes.hardLimit).toBe('boolean');
  });

  // -------------------------------------------------------------------------
  // 5. Soft limit detection per bucket
  // -------------------------------------------------------------------------
  it('returns bucket softLimit=true when at 80% usage', async () => {
    // 120 out of 150 = 80%
    const mockSummary = createMockSummary({
      minutesUsed: 120,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.minutes.softLimit).toBe(true);
    expect(res.body.data.minutes.hardLimit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Hard limit detection per bucket
  // -------------------------------------------------------------------------
  it('returns bucket hardLimit=true when at 100% usage', async () => {
    // 150 out of 150 = 100%
    const mockSummary = createMockSummary({
      minutesUsed: 150,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.minutes.hardLimit).toBe(true);
    expect(res.body.data.minutes.softLimit).toBe(false);
    expect(res.body.data.minutes.remaining).toBe(0);
  });

  it('returns bucket hardLimit=true when over 100% usage', async () => {
    // 200 out of 150 = 133%
    const mockSummary = createMockSummary({
      minutesUsed: 200,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.minutes.hardLimit).toBe(true);
    expect(res.body.data.minutes.remaining).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7. Unlimited limits (premium)
  // -------------------------------------------------------------------------
  it('handles unlimited limits (null) correctly', async () => {
    const mockSummary = createMockSummary({
      tier: 'premium',
      minutesLimit: null,
      clipsLimit: null,
      projectsLimit: null,
      postsLimit: null,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.minutes.limit).toBeNull();
    expect(res.body.data.minutes.remaining).toBeNull();
    expect(res.body.data.minutes.softLimit).toBe(false);
    expect(res.body.data.minutes.hardLimit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. All buckets present
  // -------------------------------------------------------------------------
  it('returns all four usage buckets', async () => {
    const mockSummary = createMockSummary();
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);

    // All four buckets should be present
    expect(res.body.data).toHaveProperty('minutes');
    expect(res.body.data).toHaveProperty('clips');
    expect(res.body.data).toHaveProperty('projects');
    expect(res.body.data).toHaveProperty('posts');

    // Each bucket should have all required fields
    for (const bucket of ['minutes', 'clips', 'projects', 'posts']) {
      expect(res.body.data[bucket]).toHaveProperty('used');
      expect(res.body.data[bucket]).toHaveProperty('limit');
      expect(res.body.data[bucket]).toHaveProperty('remaining');
      expect(res.body.data[bucket]).toHaveProperty('softLimit');
      expect(res.body.data[bucket]).toHaveProperty('hardLimit');
    }
  });

  // -------------------------------------------------------------------------
  // 9. Error handling
  // -------------------------------------------------------------------------
  it('returns 405 for non-GET requests', async () => {
    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'post')
      .post('/')
      .set(commonHeaders);

    expect(res.status).toBe(405);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'method_not_allowed');
  });

  it('returns 500 for unexpected service errors', async () => {
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockRejectedValue(
      new Error('Database connection failed'),
    );

    const res = await supertestHandler(toApiHandler(billingUsageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'internal_error');
  });
});
