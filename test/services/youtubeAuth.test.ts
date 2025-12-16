// C2: YouTube OAuth service tests
import { Buffer } from 'node:buffer';
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

    // Parse the URL to check redirect_uri parameter (URLSearchParams encodes the value)
    const urlObj = new URL(url);
    const redirectUri = urlObj.searchParams.get('redirect_uri');
    expect(redirectUri).toBe('http://custom.com/callback');
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

describe('getFreshYouTubeAccessToken', () => {
  // Helper to create encrypted token in App Router format
  function encryptToken(plaintext: string): string {
    const envelope = { v: 1, p: 'youtube_token', d: plaintext };
    const json = JSON.stringify(envelope);
    const base64 = Buffer.from(json, 'utf8').toString('base64url');
    return `enc:${base64}`;
  }

  it('returns decrypted token when not expired', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const encryptedToken = encryptToken('valid-access-token');
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes from now

    const mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'account-123',
          access_token_encrypted_ref: encryptedToken,
          refresh_token_encrypted_ref: encryptToken('refresh-token'),
          expires_at: futureExpiry,
          platform: 'youtube',
        },
        error: null,
      }),
    };

    const result = await youtubeAuth.getFreshYouTubeAccessToken('account-123', {
      supabase: mockSupabase as any,
    });

    // Should return plaintext token, not encrypted
    expect(result).toBe('valid-access-token');
    expect(mockSupabase.single).toHaveBeenCalled();
    // Should NOT call fetch (no refresh needed)
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns plaintext token when stored as plaintext (backward compatibility)', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const plainToken = 'plain-access-token';
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'account-123',
          access_token_encrypted_ref: plainToken,
          refresh_token_encrypted_ref: 'plain-refresh-token',
          expires_at: futureExpiry,
          platform: 'youtube',
        },
        error: null,
      }),
    };

    const result = await youtubeAuth.getFreshYouTubeAccessToken('account-123', {
      supabase: mockSupabase as any,
    });

    // Should return plain token as-is (backward compatibility)
    expect(result).toBe('plain-access-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes token when expired and returns plaintext', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const encryptedAccessToken = encryptToken('old-access-token');
    const encryptedRefreshToken = encryptToken('valid-refresh-token');
    const pastExpiry = new Date(Date.now() - 1000).toISOString(); // 1 second ago

    // Create a chainable mock that supports both select and update operations
    const selectChain = {
      select: vi.fn(() => selectChain),
      eq: vi.fn(() => selectChain),
      single: vi.fn(),
    };
    selectChain.single.mockResolvedValue({
      data: {
        id: 'account-123',
        access_token_encrypted_ref: encryptedAccessToken,
        refresh_token_encrypted_ref: encryptedRefreshToken,
        expires_at: pastExpiry,
        platform: 'youtube',
      },
      error: null,
    });

    const updateChain = {
      eq: vi.fn().mockResolvedValue({
        error: null,
      }),
    };

    // Track the update call
    const updateFn = vi.fn().mockReturnValue(updateChain);

    // from() returns different chains based on whether we're selecting or updating
    const mockSupabase = {
      from: vi.fn((table: string) => {
        // Return a chain that supports both select and update
        const tableChain = {
          select: vi.fn(() => selectChain),
          update: updateFn,
        };
        return tableChain;
      }),
    };

    // Mock refresh token API call
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      }),
    });

    const result = await youtubeAuth.getFreshYouTubeAccessToken('account-123', {
      supabase: mockSupabase as any,
    });

    // Should return new plaintext token
    expect(result).toBe('new-access-token');

    // Should call refresh endpoint with decrypted refresh token
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('valid-refresh-token'), // Should contain plaintext refresh token
      }),
    );

    // Should update DB with encrypted new token
    // Check that from() was called for update
    expect(mockSupabase.from).toHaveBeenCalledWith('connected_accounts');
    expect(updateFn).toHaveBeenCalled();
    const updateCall = updateFn.mock.calls[0][0];
    expect(updateCall.access_token_encrypted_ref).toMatch(/^enc:/); // Should be encrypted
    expect(updateCall.expires_at).toBeTruthy();
  });

  it('refreshes token when expiring within 5 minutes', async () => {
    if (typeof envModule.clearEnvCache === 'function') {
      envModule.clearEnvCache();
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const encryptedAccessToken = encryptToken('old-access-token');
    const encryptedRefreshToken = encryptToken('valid-refresh-token');
    // 4 minutes from now (within 5-minute buffer)
    const nearExpiry = new Date(Date.now() + 4 * 60 * 1000).toISOString();

    // Create a chainable mock that supports both select and update operations
    const selectChain = {
      select: vi.fn(() => selectChain),
      eq: vi.fn(() => selectChain),
      single: vi.fn(),
    };
    selectChain.single.mockResolvedValue({
      data: {
        id: 'account-123',
        access_token_encrypted_ref: encryptedAccessToken,
        refresh_token_encrypted_ref: encryptedRefreshToken,
        expires_at: nearExpiry,
        platform: 'youtube',
      },
      error: null,
    });

    const updateChain2 = {
      eq: vi.fn().mockResolvedValue({
        error: null,
      }),
    };

    // Track the update call
    const updateFn2 = vi.fn().mockReturnValue(updateChain2);

    // from() returns different chains based on whether we're selecting or updating
    const mockSupabase = {
      from: vi.fn((table: string) => {
        // Return a chain that supports both select and update
        const tableChain = {
          select: vi.fn(() => selectChain),
          update: updateFn2,
        };
        return tableChain;
      }),
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      }),
    });

    const result = await youtubeAuth.getFreshYouTubeAccessToken('account-123', {
      supabase: mockSupabase as any,
    });

    expect(result).toBe('refreshed-token');
    expect(global.fetch).toHaveBeenCalled();
    // Check that from() was called for update
    expect(mockSupabase.from).toHaveBeenCalledWith('connected_accounts');
    expect(updateFn2).toHaveBeenCalled();
    const updateCall = updateFn2.mock.calls[0][0];
    expect(updateCall.access_token_encrypted_ref).toMatch(/^enc:/); // Should be encrypted
    expect(updateCall.expires_at).toBeTruthy();
  });

  it('throws when account not found', async () => {
    const mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      }),
    };

    await expect(
      youtubeAuth.getFreshYouTubeAccessToken('invalid-account', {
        supabase: mockSupabase as any,
      }),
    ).rejects.toThrow('Connected account not found');
  });

  it('throws when no access token', async () => {
    const mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'account-123',
          access_token_encrypted_ref: null,
          refresh_token_encrypted_ref: encryptToken('refresh-token'),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          platform: 'youtube',
        },
        error: null,
      }),
    };

    await expect(
      youtubeAuth.getFreshYouTubeAccessToken('account-123', {
        supabase: mockSupabase as any,
      }),
    ).rejects.toThrow('No access token');
  });

  it('throws when no refresh token during refresh', async () => {
    const encryptedToken = encryptToken('access-token');
    const pastExpiry = new Date(Date.now() - 1000).toISOString();

    const mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'account-123',
          access_token_encrypted_ref: encryptedToken,
          refresh_token_encrypted_ref: null,
          expires_at: pastExpiry,
          platform: 'youtube',
        },
        error: null,
      }),
    };

    await expect(
      youtubeAuth.getFreshYouTubeAccessToken('account-123', {
        supabase: mockSupabase as any,
      }),
    ).rejects.toThrow('No refresh token');
  });
});

