import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectedAccountRow } from './connected-account';

/**
 * Fetch a connected account by workspace ID and platform.
 * Only returns accounts with status = 'active'.
 *
 * @param client - Supabase client instance
 * @param workspaceId - Workspace UUID
 * @param platform - Platform identifier ('tiktok' | 'youtube')
 * @returns ConnectedAccountRow or null if not found or error
 */
export async function getConnectedAccount(
  client: SupabaseClient,
  workspaceId: string,
  platform: ConnectedAccountRow['platform'],
): Promise<ConnectedAccountRow | null> {
  const { data, error } = await client
    .from('connected_accounts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    // do NOT throw; log & return null to keep caller safe
    console.error('getConnectedAccount error', { error });
    return null;
  }

  return data;
}

