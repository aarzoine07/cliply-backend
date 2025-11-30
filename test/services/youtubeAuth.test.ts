// C2: YouTube OAuth service tests
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearEnvCache } from '@cliply/shared/env';
import { resetEnvForTesting } from '../../apps/web/src/lib/env';
import * as youtubeAuth from '../../packages/shared/src/services/youtubeAuth';

// Mock fetch globally
global.fetch = vi.fn();

// Capture original env at module load
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  // Reset env to baseline - this clears cache internally
  resetEnvForTesting();
  // CRITICAL: Set NODE_ENV to "test" to enable non-caching behavior in getEnv()
  process.env.NODE_ENV = 'test';
  // Ensure cache is cleared (no-op in test mode, but harmless)
  clearEnvCache();
  // Set required env vars for schema validation (these are required by the schema)
  // Use test values that won't interfere with actual functionality
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key-min-20-chars';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key-min-20-chars';
  // Delete YouTube OAuth vars to ensure clean state
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.YOUTUBE_OAUTH_REDIRECT_URL;
  // Clear cache again after setting/deleting
  clearEnvCache();
});

afterAll(() => {
  // Restore original env
  process.env = { ...ORIGINAL_ENV };
});

describe('buildYouTubeAuthUrl', () => {
  it('builds correct authorization URL', () => {
    // Set env vars for this test - must be set before getEnv() is called
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_OAUTH_REDIRECT_URL = 'http://localhost:3000/callback';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

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
    // Explicitly delete env vars for this test
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.YOUTUBE_OAUTH_REDIRECT_URL;
    clearEnvCache();

    expect(() => {
      youtubeAuth.buildYouTubeAuthUrl({
        workspaceId: 'workspace-123',
        userId: 'user-456',
      });
    }).toThrow('not configured');
  });

  it('uses custom redirect URI when provided', () => {
    // Set env vars for this test (redirectUri param will override YOUTUBE_OAUTH_REDIRECT_URL)
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_OAUTH_REDIRECT_URL = 'http://localhost:3000/default';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

    const url = youtubeAuth.buildYouTubeAuthUrl({
      workspaceId: 'workspace-123',
      userId: 'user-456',
      redirectUri: 'http://custom.com/callback',
    });

    // The redirect URI is URL-encoded in the query string, so check for the encoded version
    expect(url).toContain('http%3A%2F%2Fcustom.com%2Fcallback');
    // Also verify it's not using the default from env
    expect(url).not.toContain('http%3A%2F%2Flocalhost%3A3000%2Fdefault');
  });
});

describe('exchangeYouTubeCodeForTokens', () => {
  it('exchanges code for tokens', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

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
    // Set env vars for this test
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid code',
    });

    await expect(
      youtubeAuth.exchangeYouTubeCodeForTokens({
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
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

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
    // Set env vars for this test
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    // Clear cache AFTER setting env vars so getEnv() reads fresh values
    clearEnvCache();

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid refresh token',
    });

    await expect(
      youtubeAuth.refreshYouTubeAccessToken('invalid-refresh'),
    ).rejects.toThrow('Failed to refresh');
  });
});

