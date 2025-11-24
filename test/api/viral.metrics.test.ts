import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as metricsService from '../../apps/web/src/lib/viral/metricsService';
import metricsRoute from '../../apps/web/src/pages/api/viral/metrics';
import { supertestHandler } from '../utils/supertest-next';

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const toApiHandler = (handler: typeof metricsRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/viral/metrics', () => {
  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(metricsRoute), 'post').post('/');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('records metrics for variant post', async () => {
    vi.spyOn(metricsService, 'recordVariantMetrics').mockResolvedValue(undefined);

    const res = await supertestHandler(toApiHandler(metricsRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        variant_post_id: '123e4567-e89b-12d3-a456-426614174000',
        views: 1000,
        likes: 50,
        comments: 10,
        shares: 5,
        watch_time_seconds: 300,
        ctr: 0.05,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.success).toBe(true);
    expect(metricsService.recordVariantMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        variant_post_id: '123e4567-e89b-12d3-a456-426614174000',
        views: 1000,
        likes: 50,
      }),
      expect.any(Object),
    );
  });

  it('records partial metrics', async () => {
    vi.spyOn(metricsService, 'recordVariantMetrics').mockResolvedValue(undefined);

    const res = await supertestHandler(toApiHandler(metricsRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        variant_post_id: '123e4567-e89b-12d3-a456-426614174000',
        views: 500,
        likes: 25,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await supertestHandler(toApiHandler(metricsRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        variant_post_id: 'invalid-uuid',
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

