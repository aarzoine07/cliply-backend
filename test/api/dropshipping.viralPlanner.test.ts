import { beforeEach, describe, expect, it, vi } from 'vitest';

import planViralLoopRoute from '../../apps/web/src/pages/api/dropshipping/products/[id]/plan-viral-loop';
import * as viralPlannerService from '../../apps/web/src/lib/dropshipping/viralPlannerService';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof planViralLoopRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/dropshipping/products/:id/plan-viral-loop', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid product ID', async () => {
    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: 'invalid-uuid' })
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid maxActions (too large)', async () => {
    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        maxActions: 100,
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid maxActions (negative)', async () => {
    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        maxActions: -1,
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid window', async () => {
    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        window: 'invalid',
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('plans reposts for underperformers', async () => {
    const mockActions = [
      {
        id: '223e4567-e89b-12d3-a456-426614174000',
        workspaceId: '11111111-1111-1111-1111-111111111111',
        productId: '123e4567-e89b-12d3-a456-426614174000',
        clipId: '323e4567-e89b-12d3-a456-426614174000',
        variantPostId: '423e4567-e89b-12d3-a456-426614174000',
        actionType: 'repost' as const,
        status: 'planned' as const,
        reasons: ['low_ctr', 'below_product_median'] as const,
        plannedCreative: {
          caption: 'Check out this amazing product! 🚀',
          script: 'Hey everyone! Today I want to show you something incredible...',
          hashtags: ['product', 'dropshipping', 'viral'],
          hook: 'This product will change your life!',
          soundIdea: 'trending high-energy',
        },
        createdAt: '2025-11-30T12:00:00Z',
        executedAt: null,
        skippedAt: null,
      },
    ];

    vi.spyOn(viralPlannerService, 'planRepostsForUnderperformers').mockResolvedValue(mockActions);

    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        window: '7d',
        minViews: 500,
        maxCtr: 0.05,
        maxActions: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(mockActions[0].id);
    expect(res.body.data[0].actionType).toBe('repost');
    expect(res.body.data[0].status).toBe('planned');
    expect(res.body.data[0].reasons).toContain('low_ctr');
    expect(res.body.data[0].plannedCreative).toHaveProperty('caption');
    expect(res.body.data[0].plannedCreative).toHaveProperty('script');
    expect(res.body.data[0].plannedCreative).toHaveProperty('hashtags');
    expect(Array.isArray(res.body.data[0].plannedCreative.hashtags)).toBe(true);
  });

  it('defaults query parameters when not specified', async () => {
    const mockActions: any[] = [];

    vi.spyOn(viralPlannerService, 'planRepostsForUnderperformers').mockResolvedValue(mockActions);

    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(200);
    expect(viralPlannerService.planRepostsForUnderperformers).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '123e4567-e89b-12d3-a456-426614174000',
      expect.objectContaining({
        window: '7d',
        minViews: 500,
        maxCtr: 0.05,
        maxActions: 10,
      }),
      expect.any(Object),
    );
  });

  it('respects maxActions limit', async () => {
    const mockActions = Array.from({ length: 5 }, (_, i) => ({
      id: `223e4567-e89b-12d3-a456-42661417400${i}`,
      workspaceId: '11111111-1111-1111-1111-111111111111',
      productId: '123e4567-e89b-12d3-a456-426614174000',
      clipId: '323e4567-e89b-12d3-a456-426614174000',
      variantPostId: `423e4567-e89b-12d3-a456-42661417400${i}`,
      actionType: 'repost' as const,
      status: 'planned' as const,
      reasons: ['low_ctr'] as const,
      plannedCreative: {
        caption: 'Test caption',
        script: 'Test script',
        hashtags: ['test'],
      },
      createdAt: '2025-11-30T12:00:00Z',
      executedAt: null,
      skippedAt: null,
    }));

    vi.spyOn(viralPlannerService, 'planRepostsForUnderperformers').mockResolvedValue(mockActions);

    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        maxActions: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5); // Service returns what it created, but it should respect maxActions internally
    // The service should have been called with maxActions: 3
    expect(viralPlannerService.planRepostsForUnderperformers).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxActions: 3 }),
      expect.any(Object),
    );
  });

  it('returns 404 when product not found', async () => {
    vi.spyOn(viralPlannerService, 'planRepostsForUnderperformers').mockRejectedValue(
      new Error('Product not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' })
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns empty array when no underperformers found', async () => {
    vi.spyOn(viralPlannerService, 'planRepostsForUnderperformers').mockResolvedValue([]);

    const res = await supertestHandler(toApiHandler(planViralLoopRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});

