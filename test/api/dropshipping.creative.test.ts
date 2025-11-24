import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import creativeSuggestRoute from '../../apps/web/src/pages/api/dropshipping/creative/suggest';
import * as creativeService from '../../apps/web/src/lib/dropshipping/creativeService';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof creativeSuggestRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/dropshipping/creative/suggest', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174000',
      });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid payload (missing productId)', async () => {
    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid productId format', async () => {
    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: 'invalid-uuid',
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('generates creative for product', async () => {
    const mockCreative = {
      hook: 'This product will change your life!',
      caption: 'Check out this amazing product! 🚀\n\nLink in bio!',
      hashtags: ['product', 'dropshipping', 'viral'],
      script: 'Hey everyone! Today I want to show you something incredible...',
      soundIdea: 'trending high-energy',
    };

    vi.spyOn(creativeService, 'generateCreativeForProduct').mockResolvedValue(mockCreative);

    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174000',
        platform: 'tiktok',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('hook');
    expect(res.body).toHaveProperty('caption');
    expect(res.body).toHaveProperty('hashtags');
    expect(res.body).toHaveProperty('script');
    expect(res.body).toHaveProperty('soundIdea');
    expect(res.body.hook).toBe(mockCreative.hook);
    expect(res.body.caption).toBe(mockCreative.caption);
    expect(Array.isArray(res.body.hashtags)).toBe(true);
  });

  it('generates creative with clipId', async () => {
    const mockCreative = {
      hook: 'Watch this before buying!',
      caption: 'Full review coming up! 🔥',
      hashtags: ['review', 'unboxing'],
      script: 'Let me show you what I got...',
      soundIdea: 'calm storytime',
    };

    vi.spyOn(creativeService, 'generateCreativeForProduct').mockResolvedValue(mockCreative);

    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174000',
        clipId: '223e4567-e89b-12d3-a456-426614174000',
        platform: 'youtube_shorts',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(creativeService.generateCreativeForProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: '123e4567-e89b-12d3-a456-426614174000',
        clipId: '223e4567-e89b-12d3-a456-426614174000',
        platform: 'youtube_shorts',
      }),
      expect.any(Object),
    );
  });

  it('returns 404 when product not found', async () => {
    vi.spyOn(creativeService, 'generateCreativeForProduct').mockRejectedValue(
      new Error('Product not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174999',
      });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when clip not found', async () => {
    vi.spyOn(creativeService, 'generateCreativeForProduct').mockRejectedValue(
      new Error('Clip not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174000',
        clipId: '223e4567-e89b-12d3-a456-426614174999',
      });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('defaults to tiktok platform when not specified', async () => {
    const mockCreative = {
      hook: 'Test hook',
      caption: 'Test caption',
      hashtags: ['test'],
      script: 'Test script',
      soundIdea: 'test mood',
    };

    vi.spyOn(creativeService, 'generateCreativeForProduct').mockResolvedValue(mockCreative);

    const res = await supertestHandler(toApiHandler(creativeSuggestRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        productId: '123e4567-e89b-12d3-a456-426614174000',
      });

    expect(res.status).toBe(200);
    expect(creativeService.generateCreativeForProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: '123e4567-e89b-12d3-a456-426614174000',
        platform: 'tiktok',
      }),
      expect.any(Object),
    );
  });
});

describe('GET /api/dropshipping/products/:id/creative', () => {
  let creativeSpecRoute: typeof import('../../apps/web/src/pages/api/dropshipping/products/[id]/creative').default;

  beforeAll(async () => {
    creativeSpecRoute = (await import('../../apps/web/src/pages/api/dropshipping/products/[id]/creative')).default;
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'get')
      .get('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid product ID', async () => {
    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: 'invalid-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when product not found', async () => {
    const creativeService = await import('../../apps/web/src/lib/dropshipping/creativeService');
    vi.spyOn(creativeService, 'getCreativeSpecForProduct').mockResolvedValue(null);

    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns creative spec for product', async () => {
    const mockSpec = {
      productId: '123e4567-e89b-12d3-a456-426614174000',
      primaryAngle: 'make your life easier as a busy mom',
      audience: 'women 18-30, US/Canada, TikTok-native',
      benefits: ['saves time', 'affordable'],
      objections: ['quality concerns'],
      tone: 'high_energy' as const,
      platforms: ['tiktok' as const],
      language: 'en',
      notes: 'Focus on convenience',
    };

    const creativeService = await import('../../apps/web/src/lib/dropshipping/creativeService');
    vi.spyOn(creativeService, 'getCreativeSpecForProduct').mockResolvedValue(mockSpec);

    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.primaryAngle).toBe(mockSpec.primaryAngle);
    expect(res.body.audience).toBe(mockSpec.audience);
    expect(Array.isArray(res.body.benefits)).toBe(true);
  });

  it('returns default spec when no spec exists', async () => {
    const mockSpec = {
      productId: '123e4567-e89b-12d3-a456-426614174000',
      primaryAngle: null,
      audience: null,
      benefits: null,
      objections: null,
      tone: null,
      platforms: null,
      language: null,
      notes: null,
    };

    const creativeService = await import('../../apps/web/src/lib/dropshipping/creativeService');
    vi.spyOn(creativeService, 'getCreativeSpecForProduct').mockResolvedValue(mockSpec);

    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'get')
      .get('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.primaryAngle).toBeNull();
  });
});

describe('PUT /api/dropshipping/products/:id/creative', () => {
  let creativeSpecRoute: typeof import('../../apps/web/src/pages/api/dropshipping/products/[id]/creative').default;

  beforeAll(async () => {
    creativeSpecRoute = (await import('../../apps/web/src/pages/api/dropshipping/products/[id]/creative')).default;
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'put')
      .put('/')
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        primaryAngle: 'test angle',
      });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'put')
      .put('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        tone: 'invalid_tone',
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('upserts creative spec for product', async () => {
    const mockSpec = {
      productId: '123e4567-e89b-12d3-a456-426614174000',
      primaryAngle: 'make your life easier',
      audience: 'women 18-30',
      benefits: ['saves time'],
      objections: null,
      tone: 'high_energy' as const,
      platforms: ['tiktok' as const],
      language: 'en',
      notes: null,
    };

    const creativeService = await import('../../apps/web/src/lib/dropshipping/creativeService');
    vi.spyOn(creativeService, 'upsertCreativeSpecForProduct').mockResolvedValue(mockSpec);

    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'put')
      .put('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174000' })
      .send({
        primaryAngle: 'make your life easier',
        audience: 'women 18-30',
        tone: 'high_energy',
        platforms: ['tiktok'],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.primaryAngle).toBe(mockSpec.primaryAngle);
    expect(res.body.tone).toBe('high_energy');
  });

  it('returns 404 when product not found', async () => {
    const creativeService = await import('../../apps/web/src/lib/dropshipping/creativeService');
    vi.spyOn(creativeService, 'upsertCreativeSpecForProduct').mockRejectedValue(
      new Error('Product not found or does not belong to workspace'),
    );

    const res = await supertestHandler(toApiHandler(creativeSpecRoute), 'put')
      .put('/')
      .set(commonHeaders)
      .query({ id: '123e4567-e89b-12d3-a456-426614174999' })
      .send({
        primaryAngle: 'test',
      });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

