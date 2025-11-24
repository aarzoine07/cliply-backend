import { beforeEach, describe, expect, it, vi } from 'vitest';

import executeActionRoute from '../../apps/web/src/pages/api/dropshipping/actions/[id]/execute';
import * as actionExecutorService from '../../apps/web/src/lib/dropshipping/actionExecutorService';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof executeActionRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/dropshipping/actions/:id/execute', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid action ID', async () => {
    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: 'invalid-uuid' })
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when action not found', async () => {
    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockRejectedValue(
      new Error('Action not found'),
    );

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' })
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 409 when action already executed', async () => {
    const error = new Error('Action already executed or skipped');
    (error as any).status = 409;
    (error as any).code = 'action_already_processed';
    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockRejectedValue(error);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('action_already_processed');
  });

  it('returns 409 when action already skipped', async () => {
    const error = new Error('Action already executed or skipped');
    (error as any).status = 409;
    (error as any).code = 'action_already_processed';
    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockRejectedValue(error);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
  });

  it('executes action and returns updated action', async () => {
    const mockAction = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      productId: '223e4567-e89b-12d3-a456-426614174000',
      clipId: '323e4567-e89b-12d3-a456-426614174000',
      variantPostId: '423e4567-e89b-12d3-a456-426614174000',
      actionType: 'repost' as const,
      status: 'executed' as const,
      reasons: ['low_ctr', 'below_product_median'] as const,
      plannedCreative: {
        caption: 'Check out this amazing product! 🚀\n\nLink in bio!',
        script: 'Hey everyone! Today I want to show you something incredible...',
        hashtags: ['product', 'dropshipping', 'viral'],
        hook: 'This product will change your life!',
        soundIdea: 'trending high-energy',
      },
      createdAt: '2025-11-30T12:00:00Z',
      executedAt: '2025-11-30T12:05:00Z',
      skippedAt: null,
    };

    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockResolvedValue(mockAction);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(mockAction.id);
    expect(res.body.data.status).toBe('executed');
    expect(res.body.data.executedAt).toBeTruthy();
    expect(res.body.data.plannedCreative).toHaveProperty('caption');
    expect(res.body.data.plannedCreative).toHaveProperty('script');
    expect(res.body.data.plannedCreative).toHaveProperty('hashtags');
  });

  it('supports dryRun mode', async () => {
    const mockAction = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      productId: '223e4567-e89b-12d3-a456-426614174000',
      clipId: '323e4567-e89b-12d3-a456-426614174000',
      variantPostId: '423e4567-e89b-12d3-a456-426614174000',
      actionType: 'repost' as const,
      status: 'planned' as const, // Still planned in dry run
      reasons: ['low_ctr'] as const,
      plannedCreative: {
        caption: 'Test caption',
        script: 'Test script',
        hashtags: ['test'],
        rawModelOutput: {
          _dryRunJob: {
            kind: 'PUBLISH_TIKTOK',
            payload: {
              clipId: '323e4567-e89b-12d3-a456-426614174000',
              connectedAccountId: '523e4567-e89b-12d3-a456-426614174000',
              caption: 'Test caption',
            },
          },
        },
      },
      createdAt: '2025-11-30T12:00:00Z',
      executedAt: null,
      skippedAt: null,
    };

    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockResolvedValue(mockAction);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('planned'); // Still planned in dry run
    expect(res.body.data.executedAt).toBeNull();
    expect(res.body.data.plannedCreative.rawModelOutput).toHaveProperty('_dryRunJob');
    expect(actionExecutorService.executeDropshippingAction).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '123e4567-e89b-12d3-a456-426614174000',
      expect.objectContaining({ dryRun: true }),
      expect.any(Object),
    );
  });

  it('defaults dryRun to false when not specified', async () => {
    const mockAction = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      productId: '223e4567-e89b-12d3-a456-426614174000',
      clipId: '323e4567-e89b-12d3-a456-426614174000',
      variantPostId: '423e4567-e89b-12d3-a456-426614174000',
      actionType: 'repost' as const,
      status: 'executed' as const,
      reasons: ['low_ctr'] as const,
      plannedCreative: {
        caption: 'Test caption',
        script: 'Test script',
        hashtags: ['test'],
      },
      createdAt: '2025-11-30T12:00:00Z',
      executedAt: '2025-11-30T12:05:00Z',
      skippedAt: null,
    };

    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockResolvedValue(mockAction);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(200);
    expect(actionExecutorService.executeDropshippingAction).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '123e4567-e89b-12d3-a456-426614174000',
      expect.objectContaining({ dryRun: false }),
      expect.any(Object),
    );
  });

  it('returns 400 for unsupported platform', async () => {
    const error = new Error('Unsupported platform for action: instagram_reels');
    (error as any).status = 400;
    (error as any).code = 'unsupported_platform';
    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockRejectedValue(error);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for clip not ready', async () => {
    const error = new Error('Clip is not ready for publishing: status=rendering');
    (error as any).status = 400;
    (error as any).code = 'clip_not_ready';
    vi.spyOn(actionExecutorService, 'executeDropshippingAction').mockRejectedValue(error);

    const res = await supertestHandler(toApiHandler(executeActionRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

