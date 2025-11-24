// C2: YouTube OAuth service tests
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as envModule from '../../packages/shared/src/env';
import * as youtubeAuth from '../../packages/shared/src/services/youtubeAuth';

// Mock fetch globally
global.fetch = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  // Clear env cache if available
  if (typeof envModule.clearEnvCache === 'function') {
    envModule.clearEnvCache();
  }
  // Reset env
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.YOUTUBE_OAUTH_REDIRECT_URL;
});

describe('buildYouTubeAuthUrl', () => {
  it('builds correct authorization URL', () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_OAUTH_REDIRECT_URL = 'http://localhost:3000/callback';

    const url = youtubeAuth.buildYouTubeAuthUrl({
      workspaceId: 'workspace-123',
      userId: 'user-456',
    });

    expect(url).toContain('accounts.google.com');
    expect(url).toContain('test-client-id');
    expect(url).toContain('youtube.upload');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('state=');

    // Decode state
    const urlObj = new URL(url);
    const state = urlObj.searchParams.get('state');
    expect(state).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
    expect(decoded.workspaceId).toBe('workspace-123');
    expect(decoded.userId).toBe('user-456');
  });

  it('throws when OAuth not configured', () => {
    expect(() => {
      youtubeAuth.buildYouTubeAuthUrl({
        workspaceId: 'workspace-123',
        userId: 'user-456',
      });
    }).toThrow('not configured');
  });

  it('uses custom redirect URI when provided', () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_OAUTH_REDIRECT_URL = 'http://localhost:3000/default';

    const url = youtubeAuth.buildYouTubeAuthUrl({
      workspaceId: 'workspace-123',
      userId: 'user-456',
      redirectUri: 'http://custom.com/callback',
    });

    expect(url).toContain('http://custom.com/callback');
  });
});

describe('exchangeYouTubeCodeForTokens', () => {
  it('exchanges code for tokens', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      }),
    });

    const result = await youtubeAuth.exchangeYouTubeCodeForTokens({
      code: 'auth-code',
      redirectUri: 'http://localhost:3000/callback',
    });

    expect(result.accessToken).toBe('access-token-123');
    expect(result.refreshToken).toBe('refresh-token-456');
    expect(result.scope).toBe('https://www.googleapis.com/auth/youtube.upload');
    expect(result.expiresAt).toBeTruthy();

    // Verify fetch was called correctly
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );
  });

  it('throws on API error', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid code',
    });

    // Re-import to get fresh env
    const { exchangeYouTubeCodeForTokens: exchangeCode } = await import('../../packages/shared/src/services/youtubeAuth');
    await expect(
      exchangeCode({
        code: 'invalid-code',
        redirectUri: 'http://localhost:3000/callback',
      }),
    ).rejects.toThrow('Failed to exchange code');
  });
});

describe('fetchYouTubeChannelForToken', () => {
  it('fetches channel info', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'channel-123',
            snippet: {
              title: 'Test Channel',
            },
          },
        ],
      }),
    });

    const result = await youtubeAuth.fetchYouTubeChannelForToken('access-token');

    expect(result.channelId).toBe('channel-123');
    expect(result.channelTitle).toBe('Test Channel');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('youtube/v3/channels'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer access-token',
        },
      }),
    );
  });

  it('throws when no channel found', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
      }),
    });

    await expect(youtubeAuth.fetchYouTubeChannelForToken('access-token')).rejects.toThrow('No YouTube channel');
  });
});

describe('refreshYouTubeAccessToken', () => {
  it('refreshes access token', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      }),
    });

    const result = await youtubeAuth.refreshYouTubeAccessToken('refresh-token');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.expiresAt).toBeTruthy();
    expect(result.scope).toBe('https://www.googleapis.com/auth/youtube.upload');
  });

  it('throws on refresh failure', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid refresh token',
    });

    // Re-import to get fresh env
    const { refreshYouTubeAccessToken: refreshToken } = await import('../../packages/shared/src/services/youtubeAuth');
    await expect(refreshToken('invalid-refresh')).rejects.toThrow('Failed to refresh');
  });
});

