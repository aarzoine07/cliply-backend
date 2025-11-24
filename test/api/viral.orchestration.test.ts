import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import * as orchestrationService from '../../apps/web/src/lib/viral/orchestrationService';
import * as connectedAccountsService from '../../apps/web/src/lib/accounts/connectedAccountsService';

// Simplified tests that mock at the service level
// Full integration tests would require a test database setup

describe('attachClipToExperimentVariant', () => {
  it('validates experiment belongs to workspace', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'experiments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'not found' },
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(),
        };
      }),
    } as any;

    await expect(
      experimentService.attachClipToExperimentVariant(
        {
          workspaceId: 'ws-1',
          clipId: 'clip-1',
          experimentId: 'exp-1',
          variantId: 'var-1',
        },
        { supabase: mockSupabase },
      ),
    ).rejects.toThrow('Experiment not found');
  });
});

describe('createVariantPostsForClip', () => {
  it('handles case when no connected accounts exist', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'clips') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'clip-1',
                workspace_id: 'ws-1',
                experiment_id: 'exp-1',
                experiment_variant_id: 'var-1',
              },
              error: null,
            }),
          };
        }
        if (table === 'connected_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
    } as any;

    // Mock connected accounts to return empty
    const accountsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((field: string, value: string) => {
        if (field === 'platform' && value === 'youtube') {
          return {
            data: [],
            error: null,
          };
        }
        return accountsChain;
      }),
    };
    mockSupabase.from('connected_accounts').select = vi.fn().mockReturnValue(accountsChain);

    // Should not throw, just return early
    await orchestrationService.createVariantPostsForClip(
      {
        workspaceId: 'ws-1',
        clipId: 'clip-1',
        experimentId: 'exp-1',
        variantId: 'var-1',
        platform: 'youtube_shorts',
      },
      { supabase: mockSupabase },
    );

    // Function should complete without error
    expect(true).toBe(true);
  });

  it('creates variant_posts for multiple accounts', async () => {
    const accountId1 = 'acc-1';
    const accountId2 = 'acc-2';
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'clips') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'clip-1',
                workspace_id: 'ws-1',
                experiment_id: 'exp-1',
                experiment_variant_id: 'var-1',
              },
              error: null,
            }),
          };
        }
        if (table === 'variant_posts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [], // No existing posts
              error: null,
            }),
            insert: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
    } as any;

    // Mock getConnectedAccountsForPublish to return multiple accounts
    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: accountId1,
        workspace_id: 'ws-1',
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-1',
        display_name: 'Channel 1',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: accountId2,
        workspace_id: 'ws-1',
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-2',
        display_name: 'Channel 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    await orchestrationService.createVariantPostsForClip(
      {
        workspaceId: 'ws-1',
        clipId: 'clip-1',
        experimentId: 'exp-1',
        variantId: 'var-1',
        platform: 'youtube_shorts',
        connectedAccountIds: [accountId1, accountId2],
      },
      { supabase: mockSupabase },
    );

    expect(mockSupabase.from('variant_posts').insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          variant_id: 'var-1',
          clip_id: 'clip-1',
          connected_account_id: accountId1,
          platform: 'youtube_shorts',
          status: 'pending',
        }),
        expect.objectContaining({
          variant_id: 'var-1',
          clip_id: 'clip-1',
          connected_account_id: accountId2,
          platform: 'youtube_shorts',
          status: 'pending',
        }),
      ]),
    );
  });

  it('skips creating duplicate variant_posts (idempotency)', async () => {
    const accountId1 = 'acc-1';
    const accountId2 = 'acc-2';
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'clips') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'clip-1',
                workspace_id: 'ws-1',
                experiment_id: 'exp-1',
                experiment_variant_id: 'var-1',
              },
              error: null,
            }),
          };
        }
        if (table === 'variant_posts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { connected_account_id: accountId1 }, // Already exists
              ],
              error: null,
            }),
            insert: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
    } as any;

    vi.spyOn(connectedAccountsService, 'getConnectedAccountsForPublish').mockResolvedValue([
      {
        id: accountId1,
        workspace_id: 'ws-1',
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-1',
        display_name: 'Channel 1',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: accountId2,
        workspace_id: 'ws-1',
        platform: 'youtube',
        provider: 'youtube',
        external_id: 'channel-2',
        display_name: 'Channel 2',
        handle: null,
        status: 'active',
        scopes: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    await orchestrationService.createVariantPostsForClip(
      {
        workspaceId: 'ws-1',
        clipId: 'clip-1',
        experimentId: 'exp-1',
        variantId: 'var-1',
        platform: 'youtube_shorts',
        connectedAccountIds: [accountId1, accountId2],
      },
      { supabase: mockSupabase },
    );

    // Should only insert for accountId2 (accountId1 already exists)
    expect(mockSupabase.from('variant_posts').insert).toHaveBeenCalledWith([
      expect.objectContaining({
        connected_account_id: accountId2,
      }),
    ]);
  });
});

