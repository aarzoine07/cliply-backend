// C2: YouTube OAuth API tests
import { beforeEach, describe, expect, it, vi } from 'vitest';

import googleOAuthStart from '../../apps/web/src/pages/api/oauth/google/start';
import googleOAuthCallback from '../../apps/web/src/pages/api/oauth/google/callback';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof googleOAuthStart | typeof googleOAuthCallback) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

beforeEach(() => {
  vi.restoreAllMocks();
  clearEnvCache();
});

describe('GET /api/oauth/google/start', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(googleOAuthStart), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('returns 400 when workspace is missing', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(googleOAuthStart), 'get')
      .get('/')
      .set('x-debug-user', userId);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('returns OAuth URL when configured', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // Mock env vars
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: 'test-client-id',
      YOUTUBE_OAUTH_REDIRECT_URL: 'http://localhost:3000/api/oauth/google/callback',
    };

    try {
      const res = await supertestHandler(toApiHandler(googleOAuthStart), 'get')
        .get('/')
        .set('x-debug-user', userId)
        .set('x-debug-workspace', workspaceId);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body.data).toHaveProperty('url');
      expect(res.body.data.url).toContain('accounts.google.com');
      expect(res.body.data.url).toContain('test-client-id');
      expect(res.body.data.url).toContain('youtube.upload');
    } finally {
      process.env = originalEnv;
    }
  });

  it('returns 500 when OAuth not configured', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // Remove env vars
    const originalEnv = process.env;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.YOUTUBE_OAUTH_REDIRECT_URL;

    try {
      const res = await supertestHandler(toApiHandler(googleOAuthStart), 'get')
        .get('/')
        .set('x-debug-user', userId)
        .set('x-debug-workspace', workspaceId);

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('ok', false);
    } finally {
      process.env = originalEnv;
    }
  });
});

describe('GET /api/oauth/google/callback', () => {
  it('returns 400 when code is missing', async () => {
    const res = await supertestHandler(toApiHandler(googleOAuthCallback), 'get')
      .get('/?state=test');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('returns 400 when state is missing', async () => {
    const res = await supertestHandler(toApiHandler(googleOAuthCallback), 'get')
      .get('/?code=test-code');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('returns 400 when state is invalid', async () => {
    const res = await supertestHandler(toApiHandler(googleOAuthCallback), 'get')
      .get('/?code=test-code&state=invalid-state');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('handles OAuth error parameter', async () => {
    const res = await supertestHandler(toApiHandler(googleOAuthCallback), 'get')
      .get('/?error=access_denied');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body.code).toBe('oauth_error');
  });
});

