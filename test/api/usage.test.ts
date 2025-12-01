import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usageTracker from '../../packages/shared/billing/usageTracker';
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
    
    // Verify alerts field is present
    expect(res.body.alerts).toBeDefined();
    expect(res.body.alerts.hasWarning).toBe(false);
    expect(res.body.alerts.hasExceeded).toBe(false);
    expect(res.body.alerts.metrics).toHaveLength(3);
    
    // Verify alert metrics structure
    const sourceMinutesAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'source_minutes');
    expect(sourceMinutesAlert).toBeDefined();
    expect(sourceMinutesAlert.level).toBe('normal');
    expect(sourceMinutesAlert.percent).toBe(14); // 123/900 * 100 = 13.67, rounded to 14
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
    
    // Verify alerts for unlimited metrics
    expect(res.body.alerts.hasWarning).toBe(false);
    expect(res.body.alerts.hasExceeded).toBe(false);
    const sourceMinutesAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'source_minutes');
    expect(sourceMinutesAlert.level).toBe('normal');
    expect(sourceMinutesAlert.percent).toBe(0);
  });

  it('returns warning level when usage is between 80-99%', async () => {
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      planName: 'basic',
      periodStart: new Date('2025-11-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 120, limit: 150 }, // 80%
        clips: { used: 400, limit: 450 }, // ~89%
        projects: { used: 10, limit: 150 }, // normal
      },
    });

    const res = await supertestHandler(toApiHandler(usageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.alerts.hasWarning).toBe(true);
    expect(res.body.alerts.hasExceeded).toBe(false);
    
    const sourceMinutesAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'source_minutes');
    expect(sourceMinutesAlert.level).toBe('warning');
    expect(sourceMinutesAlert.percent).toBe(80);
    
    const clipsAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'clips');
    expect(clipsAlert.level).toBe('warning');
    expect(clipsAlert.percent).toBe(89);
    
    const projectsAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'projects');
    expect(projectsAlert.level).toBe('normal');
  });

  it('returns exceeded level when usage is >= 100%', async () => {
    vi.spyOn(usageTracker, 'getUsageSummary').mockResolvedValue({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      planName: 'basic',
      periodStart: new Date('2025-11-01T00:00:00.000Z'),
      metrics: {
        source_minutes: { used: 150, limit: 150 }, // 100%
        clips: { used: 500, limit: 450 }, // ~111%
        projects: { used: 10, limit: 150 }, // normal
      },
    });

    const res = await supertestHandler(toApiHandler(usageRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.alerts.hasWarning).toBe(false);
    expect(res.body.alerts.hasExceeded).toBe(true);
    
    const sourceMinutesAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'source_minutes');
    expect(sourceMinutesAlert.level).toBe('exceeded');
    expect(sourceMinutesAlert.percent).toBe(100);
    
    const clipsAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'clips');
    expect(clipsAlert.level).toBe('exceeded');
    expect(clipsAlert.percent).toBe(111);
    
    const projectsAlert = res.body.alerts.metrics.find((m: any) => m.metric === 'projects');
    expect(projectsAlert.level).toBe('normal');
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

