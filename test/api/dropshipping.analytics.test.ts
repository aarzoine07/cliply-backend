import { beforeEach, describe, expect, it, vi } from 'vitest';

import performanceRoute from '../../apps/web/src/pages/api/dropshipping/products/[id]/performance';
import underperformersRoute from '../../apps/web/src/pages/api/dropshipping/products/[id]/underperformers';
import * as analyticsService from '../../apps/web/src/lib/dropshipping/analyticsService';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof performanceRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/dropshipping/products/:id/performance', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid product ID', async () => {
    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: 'invalid-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid window query', async () => {
    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000', window: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns performance summary for product', async () => {
    const mockSummary = {
      productId: '123e4567-e89b-12d3-a456-426614174000',
      window: '30d',
      totals: {
        views: 10000,
        likes: 500,
        comments: 50,
        shares: 100,
        watchTimeSeconds: 50000,
      },
      derived: {
        avgViewDurationSec: 5,
        avgCtr: 0.05,
      },
      byPlatform: [
        {
          platform: 'tiktok' as const,
          views: 8000,
          likes: 400,
          comments: 40,
          shares: 80,
          watchTimeSeconds: 40000,
        },
      ],
      topVariants: [],
    };

    vi.spyOn(analyticsService, 'getProductPerformanceSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000', window: '30d' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.productId).toBe(mockSummary.productId);
    expect(res.body.data.totals.views).toBe(10000);
    expect(res.body.data.derived.avgViewDurationSec).toBe(5);
    expect(Array.isArray(res.body.data.byPlatform)).toBe(true);
  });

  it('defaults to 30d window when not specified', async () => {
    const mockSummary = {
      productId: '123e4567-e89b-12d3-a456-426614174000',
      window: '30d',
      totals: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchTimeSeconds: 0,
      },
      derived: {},
      byPlatform: [],
      topVariants: [],
    };

    vi.spyOn(analyticsService, 'getProductPerformanceSummary').mockResolvedValue(mockSummary);

    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });

    expect(res.status).toBe(200);
    expect(analyticsService.getProductPerformanceSummary).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '123e4567-e89b-12d3-a456-426614174000',
      expect.objectContaining({ window: '30d' }),
      expect.any(Object),
    );
  });

  it('returns 404 when product not found', async () => {
    vi.spyOn(analyticsService, 'getProductPerformanceSummary').mockRejectedValue(
      new Error('Product not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(performanceRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/dropshipping/products/:id/underperformers', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid product ID', async () => {
    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: 'invalid-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid minViews (negative)', async () => {
    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000', minViews: -1 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid maxCtr (out of range)', async () => {
    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000', maxCtr: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns underperformers for product', async () => {
    const mockUnderperformers = [
      {
        variantPostId: '223e4567-e89b-12d3-a456-426614174000',
        clipId: '323e4567-e89b-12d3-a456-426614174000',
        productId: '123e4567-e89b-12d3-a456-426614174000',
        platform: 'tiktok' as const,
        views: 600,
        likes: 10,
        watchTimeSeconds: 1000,
        ctr: 0.02,
        reason: ['low_ctr', 'below_product_median'] as const,
      },
    ];

    vi.spyOn(analyticsService, 'getUnderperformingPostsForProduct').mockResolvedValue(mockUnderperformers);

    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000', window: '7d', minViews: 500 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].variantPostId).toBe(mockUnderperformers[0].variantPostId);
    expect(res.body.data[0].reason).toContain('low_ctr');
  });

  it('defaults query parameters when not specified', async () => {
    const mockUnderperformers: any[] = [];

    vi.spyOn(analyticsService, 'getUnderperformingPostsForProduct').mockResolvedValue(mockUnderperformers);

    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });

    expect(res.status).toBe(200);
    expect(analyticsService.getUnderperformingPostsForProduct).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '123e4567-e89b-12d3-a456-426614174000',
      expect.objectContaining({
        window: '7d',
        minViews: 500,
        maxCtr: 0.05,
      }),
      expect.any(Object),
    );
  });

  it('returns 404 when product not found', async () => {
    vi.spyOn(analyticsService, 'getUnderperformingPostsForProduct').mockRejectedValue(
      new Error('Product not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(underperformersRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

