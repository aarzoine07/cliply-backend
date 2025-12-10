import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageTracker from '/shared/billing/usageTracker';
import usageRoute from '../../apps/web/src/pages/api/usage';
import { supertestHandler } from '../utils/supertest-next';

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const toApiHandler = (handler: typeof usageRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/usage', () => {
  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(usageRoute), 'get').get('/');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns usage summary for workspace', async () => {
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      planName: 'pro',
      periodStart: new Date('2025-11-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 123, limit: 900 },
        clips: { used: 45, limit: 10800 },
        projects: { used: 10, limit: 900 },
      },
    });

    const res = await supertestHandler(toApiHandler(usageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.plan).toBe('pro');
    expect(res.body.metrics.source_minutes).toEqual({ used: 123, limit: 900 });
    expect(res.body.metrics.clips).toEqual({ used: 45, limit: 10800 });
    expect(res.body.metrics.projects).toEqual({ used: 10, limit: 900 });
  });

  it('handles unlimited metrics (limit: null)', async () => {
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      planName: 'premium',
      periodStart: new Date('2025-11-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 1000, limit: null },
        clips: { used: 500, limit: null },
      },
    });

    const res = await supertestHandler(toApiHandler(usageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.metrics.source_minutes.limit).toBeNull();
  });

  it('returns 500 on unexpected errors', async () => {
    vi.spyOn(usageTracker, 'getUsageSummary').mockRejectedValue(new Error('Database error'));

    const res = await supertestHandler(toApiHandler(usageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

