// D1: Billing status endpoint tests - updated for new response format
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageService from '../../src/lib/billing/usageService';
import billingStatusRoute from '../../src/pages/api/billing/status';
import { supertestHandler } from '../../../../test/utils/supertest-next';

const toApiHandler = (handler: typeof billingStatusRoute) =>
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

describe('GET /api/billing/status', () => {
  // -------------------------------------------------------------------------
  // 1. Unauthorized (401)
  // -------------------------------------------------------------------------
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get').get('/');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code');
  });

  // -------------------------------------------------------------------------
  // 2. Invalid or missing workspace header (400)
  // -------------------------------------------------------------------------
  it('returns 400 when workspace is missing', async () => {
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set('x-debug-user', userId);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'invalid_request');
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 for invalid workspace header format', async () => {
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
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

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', nonExistentWorkspaceId);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'workspace_not_found');
    expect(res.body).toHaveProperty('message', 'Workspace not found');
  });

  // -------------------------------------------------------------------------
  // 4. Success (200) - basic structure
  // -------------------------------------------------------------------------
  it('returns 200 with full billing status structure', async () => {
    const mockSummary = createMockSummary();
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    // Verify plan structure
    expect(res.body.data).toHaveProperty('plan');
    expect(res.body.data.plan).toHaveProperty('tier');
    expect(res.body.data.plan.tier).toMatch(/^(basic|pro|premium)$/);
    expect(res.body.data.plan).toHaveProperty('billingStatus');
    expect(res.body.data.plan).toHaveProperty('trial');
    expect(res.body.data.plan.trial).toHaveProperty('active');
    expect(res.body.data.plan.trial).toHaveProperty('endsAt');

    // Verify usage structure
    expect(res.body.data).toHaveProperty('usage');
    expect(res.body.data.usage).toHaveProperty('minutes');
    expect(res.body.data.usage).toHaveProperty('clips');
    expect(res.body.data.usage).toHaveProperty('projects');
    expect(res.body.data.usage).toHaveProperty('posts');

    // Verify usage bucket structure
    const { minutes } = res.body.data.usage;
    expect(minutes).toHaveProperty('used');
    expect(minutes).toHaveProperty('limit');
    expect(minutes).toHaveProperty('remaining');
    expect(minutes).toHaveProperty('softLimit');
    expect(minutes).toHaveProperty('hardLimit');

    // Verify top-level soft/hard limit flags
    expect(res.body.data).toHaveProperty('softLimit');
    expect(res.body.data).toHaveProperty('hardLimit');
    expect(typeof res.body.data.softLimit).toBe('boolean');
    expect(typeof res.body.data.hardLimit).toBe('boolean');
  });

  it('returns correct usage values from service', async () => {
    const mockSummary = createMockSummary({
      minutesUsed: 50,
      minutesLimit: 150,
      clipsUsed: 100,
      clipsLimit: 450,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.used).toBe(50);
    expect(res.body.data.usage.minutes.limit).toBe(150);
    expect(res.body.data.usage.minutes.remaining).toBe(100);
    expect(res.body.data.usage.clips.used).toBe(100);
  });

  // -------------------------------------------------------------------------
  // 5. Trial info
  // -------------------------------------------------------------------------
  it('returns trial active when subscription is trialing', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const mockSummary = createMockSummary({
      trialActive: true,
      trialEndsAt: futureDate,
      billingStatus: 'trialing',
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.plan.trial.active).toBe(true);
    expect(res.body.data.plan.trial.endsAt).toBe(futureDate);
    expect(res.body.data.plan.billingStatus).toBe('trialing');
  });

  it('returns trial inactive when trial has expired', async () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const mockSummary = createMockSummary({
      trialActive: false,
      trialEndsAt: pastDate,
      billingStatus: 'active',
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.plan.trial.active).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Soft limit case (>= 80% but < 100%)
  // -------------------------------------------------------------------------
  it('returns softLimit=true when usage is at 80% or more', async () => {
    // 120 out of 150 = 80%
    const mockSummary = createMockSummary({
      minutesUsed: 120,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.softLimit).toBe(true);
    expect(res.body.data.usage.minutes.hardLimit).toBe(false);
    expect(res.body.data.softLimit).toBe(true);
    expect(res.body.data.hardLimit).toBe(false);
  });

  it('returns softLimit=true when usage is between 80% and 100%', async () => {
    // 140 out of 150 = 93.3%
    const mockSummary = createMockSummary({
      minutesUsed: 140,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.softLimit).toBe(true);
    expect(res.body.data.usage.minutes.hardLimit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 7. Hard limit case (>= 100%)
  // -------------------------------------------------------------------------
  it('returns hardLimit=true when usage is at 100%', async () => {
    // 150 out of 150 = 100%
    const mockSummary = createMockSummary({
      minutesUsed: 150,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.hardLimit).toBe(true);
    expect(res.body.data.usage.minutes.softLimit).toBe(false);
    expect(res.body.data.hardLimit).toBe(true);
  });

  it('returns hardLimit=true when usage exceeds 100%', async () => {
    // 200 out of 150 = 133%
    const mockSummary = createMockSummary({
      minutesUsed: 200,
      minutesLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.hardLimit).toBe(true);
    expect(res.body.data.usage.minutes.remaining).toBe(0);
    expect(res.body.data.hardLimit).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Unlimited limits (premium plan)
  // -------------------------------------------------------------------------
  it('handles unlimited limits (null) for premium plan', async () => {
    const mockSummary = createMockSummary({
      tier: 'premium',
      minutesLimit: null,
      clipsLimit: null,
      projectsLimit: null,
      postsLimit: null,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.plan.tier).toBe('premium');
    expect(res.body.data.usage.minutes.limit).toBeNull();
    expect(res.body.data.usage.minutes.remaining).toBeNull();
    expect(res.body.data.usage.minutes.softLimit).toBe(false);
    expect(res.body.data.usage.minutes.hardLimit).toBe(false);
    expect(res.body.data.softLimit).toBe(false);
    expect(res.body.data.hardLimit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 9. Multiple buckets at limit
  // -------------------------------------------------------------------------
  it('returns softLimit=true if ANY bucket is at soft limit', async () => {
    const mockSummary = createMockSummary({
      minutesUsed: 10, // well under limit
      clipsUsed: 360, // 80% of 450
      clipsLimit: 450,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.minutes.softLimit).toBe(false);
    expect(res.body.data.usage.clips.softLimit).toBe(true);
    expect(res.body.data.softLimit).toBe(true);
  });

  it('returns hardLimit=true if ANY bucket is at hard limit', async () => {
    const mockSummary = createMockSummary({
      minutesUsed: 10, // well under limit
      projectsUsed: 150, // 100% of 150
      projectsLimit: 150,
    });
    vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.projects.hardLimit).toBe(true);
    expect(res.body.data.hardLimit).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 10. Error handling
  // -------------------------------------------------------------------------
  it('returns 405 for non-GET requests', async () => {
    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'post')
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

    const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('code', 'internal_error');
  });
});

