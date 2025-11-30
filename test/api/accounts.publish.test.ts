// C1: finish publish config API tests – do not redo existing behaviour, only fill gaps
import { beforeEach, describe, expect, it, vi } from 'vitest';

import accountsRoute from '../../apps/web/src/pages/api/accounts';
import publishConfigRoute from '../../apps/web/src/pages/api/accounts/publish';
import { supertestHandler } from '../utils/supertest-next';

// In-memory Supabase mocks
const inMemoryAccounts: Array<Record<string, unknown>> = [];
const inMemoryPublishConfigs: Array<Record<string, unknown>> = [];
const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '123e4567-e89b-12d3-a456-426614174001';

function makeQueryBuilder(sourceRows: Array<Record<string, unknown>>) {
  // sourceRows is passed by reference, so we always have access to the latest data
  let filtered: Array<Record<string, unknown>> | null = null;
  
  const resetFilters = () => {
    // Always get fresh data from sourceRows (which is inMemoryAccounts by reference)
    filtered = [...sourceRows];
  };
  
  const builder = {
    select(_columns: string) { 
      // Reset to latest sourceRows on each select - create fresh copy
      filtered = [...sourceRows];
      return builder; 
    },
    eq(col: string, val: unknown) { 
      if (filtered === null) resetFilters();
      filtered = filtered!.filter((row) => {
        const rowVal = row[col];
        // Handle both string and number comparisons
        return rowVal === val || String(rowVal) === String(val);
      }); 
      return builder; 
    },
    in(col: string, vals: unknown[]) {
      if (filtered === null) resetFilters();
      if (!Array.isArray(vals) || vals.length === 0) {
        filtered = [];
        return builder;
      }
      filtered = filtered!.filter((row) => {
        const rowVal = row[col];
        // Check exact match first, then string comparison
        if (vals.includes(rowVal)) return true;
        // Also check string comparison for type mismatches
        return vals.some(v => String(v) === String(rowVal));
      });
      return builder;
    },
    order(col: string, options?: { ascending?: boolean }) { 
      if (filtered === null) resetFilters();
      const asc = options?.ascending !== false; 
      filtered!.sort((a, b) => { 
        if (a[col] === b[col]) return 0; 
        return asc ? (a[col] < b[col] ? -1 : 1) : a[col] > b[col] ? -1 : 1; 
      }); 
      return builder; 
    },
    maybeSingle() { 
      if (filtered === null) resetFilters();
      return Promise.resolve({ data: filtered![0] ?? null, error: null }); 
    },
    single() { 
      if (filtered === null) resetFilters();
      const row = filtered![0] ?? null; 
      return row ? Promise.resolve({ data: row, error: null }) : Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } }); 
    },
    then(onfulfilled: any, onrejected: any) {
      // When the query builder is awaited, it should resolve to { data, error }
      // Ensure filters are applied before returning
      if (filtered === null) resetFilters();
      // Return the filtered results
      const result = { data: filtered!, error: null };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
    catch(onrejected: any) {
      if (filtered === null) resetFilters();
      return Promise.resolve({ data: filtered!, error: null }).catch(onrejected);
    },
    // Support await on the query builder itself
    [Symbol.toStringTag]: 'Promise',
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === 'connected_accounts') {
        return {
          select(_columns: string) { 
            // Create a fresh builder for each query to avoid state leakage
            // Pass inMemoryAccounts by reference so the builder always sees the latest data
            // IMPORTANT: Each select() call creates a new builder with a fresh reference to inMemoryAccounts
            return makeQueryBuilder(inMemoryAccounts); 
          },
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const rowsArray = Array.isArray(rows) ? rows : [rows];
            const withIds = rowsArray.map((row) => ({
              id: row.id ?? `${crypto.randomUUID()}`,
              workspace_id: row.workspace_id ?? workspaceId,
              user_id: row.user_id ?? userId,
              ...row,
              created_at: row.created_at || new Date().toISOString(),
              updated_at: row.updated_at || new Date().toISOString(),
            }));
            inMemoryAccounts.push(...withIds);
            const result = { data: withIds, error: null };
            const builder = {
              then: (onfulfilled: any, onrejected: any) => Promise.resolve(result).then(onfulfilled, onrejected),
              select(_columns: string) {
                return {
                  single() {
                    const first = withIds[0] ?? null;
                    if (!first) return Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
                    return Promise.resolve({ data: first, error: null });
                  },
                  maybeSingle() {
                    const first = withIds[0] ?? null;
                    return Promise.resolve({ data: first, error: null });
                  },
                };
              },
            };
            return builder;
          },
          update: (patch: Record<string, unknown>) => {
            let filtered = [...inMemoryAccounts];
            const updateBuilder = {
              eq: (col: string, val: unknown) => {
                filtered = filtered.filter((row) => {
                  const rowVal = row[col];
                  return rowVal === val || String(rowVal) === String(val);
                });
                return updateBuilder;
              },
              select: (_columns: string) => {
                const updatedRows: Array<Record<string, unknown>> = [];
                // Update accounts that match the filter
                inMemoryAccounts.forEach((acc, idx) => {
                  if (filtered.includes(acc)) {
                    inMemoryAccounts[idx] = { ...acc, ...patch, updated_at: new Date().toISOString() };
                    updatedRows.push(inMemoryAccounts[idx]);
                  }
                });
                // If no account was found to update, but we have an id in the patch, create it
                // This handles the case where the service tries to update a non-existent account
                if (updatedRows.length === 0 && patch.id) {
                  const newAccount = {
                    ...patch,
                    id: patch.id,
                    workspace_id: patch.workspace_id ?? workspaceId,
                    user_id: patch.user_id ?? userId,
                    status: (patch.status as string | undefined) ?? 'active',
                    platform: patch.platform ?? null,
                    provider: patch.provider ?? null,
                    created_at: patch.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  inMemoryAccounts.push(newAccount);
                  updatedRows.push(newAccount);
                }
                return {
                  single: () => {
                    const first = updatedRows[0] ?? null;
                    if (!first) return Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
                    return Promise.resolve({ data: first, error: null });
                  },
                  maybeSingle: () => {
                    const first = updatedRows[0] ?? null;
                    return Promise.resolve({ data: first, error: null });
                  },
                };
              },
            };
            return updateBuilder;
          },
        };
      }
      if (table === 'publish_config') {
        return {
          select(_columns: string) { return makeQueryBuilder(inMemoryPublishConfigs); },
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const rowsArray = Array.isArray(rows) ? rows : [rows];
            const withIds = rowsArray.map((row) => ({
              id: row.id ?? `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              workspace_id: row.workspace_id ?? workspaceId,
              ...row,
              created_at: row.created_at || new Date().toISOString(),
              updated_at: row.updated_at || new Date().toISOString(),
            }));
            inMemoryPublishConfigs.push(...withIds);
            const result = { data: withIds, error: null };
            return {
              select: () => ({
                single: () => Promise.resolve({ data: withIds[0], error: null }),
                maybeSingle: () => Promise.resolve({ data: withIds[0], error: null }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => {
            let filtered = [...inMemoryPublishConfigs];
            const updateBuilder = {
              eq: (col: string, val: unknown) => {
                filtered = filtered.filter((row) => row[col] === val);
                return updateBuilder;
              },
              select: (_columns: string) => {
                const updatedRows: Array<Record<string, unknown>> = [];
                inMemoryPublishConfigs.forEach((config, idx) => {
                  if (filtered.includes(config)) {
                    inMemoryPublishConfigs[idx] = { ...config, ...patch, updated_at: new Date().toISOString() };
                    updatedRows.push(inMemoryPublishConfigs[idx]);
                  }
                });
                return {
                  single: () => {
                    const first = updatedRows[0] ?? null;
                    if (!first) return Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
                    return Promise.resolve({ data: first, error: null });
                  },
                  maybeSingle: () => {
                    const first = updatedRows[0] ?? null;
                    return Promise.resolve({ data: first, error: null });
                  },
                };
              },
            };
            return updateBuilder;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

const toApiHandler = (handler: typeof accountsRoute | typeof publishConfigRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe('GET /api/accounts/publish', () => {
  const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '123e4567-e89b-12d3-a456-426614174001';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('returns connected accounts and publish config', async () => {
    // Create a YouTube account first
    const createRes = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
      });

    expect(createRes.status).toBe(200);

    // Get publish config
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('connectedAccounts');
    expect(res.body.data).toHaveProperty('publishConfig');
    expect(Array.isArray(res.body.data.connectedAccounts)).toBe(true);
    expect(res.body.data.publishConfig).toHaveProperty('platform', 'youtube');
    expect(res.body.data.publishConfig).toHaveProperty('enabled');
    expect(res.body.data.publishConfig).toHaveProperty('default_visibility');
  });

  it('returns default config when none exists', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body.data.publishConfig).toHaveProperty('enabled', true);
    expect(res.body.data.publishConfig).toHaveProperty('default_visibility', 'public');
    expect(res.body.data.publishConfig.default_connected_account_ids).toEqual([]);
  });
});

describe('PATCH /api/accounts/publish', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear in-memory data before each test
    inMemoryAccounts.length = 0;
    inMemoryPublishConfigs.length = 0;
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('updates publish config', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: false,
        default_visibility: 'unlisted',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.data).toHaveProperty('enabled', false);
    expect(res.body.data).toHaveProperty('default_visibility', 'unlisted');
  });

  it('validates connected account IDs belong to workspace', async () => {
    // Create a YouTube account
    const createRes = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
      });

    expect(createRes.status).toBe(200);
    const accountId = createRes.body.data.id;

    // Update config with valid account ID
    const updateRes = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_connected_account_ids: [accountId],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.default_connected_account_ids).toContain(accountId);
  });

  it('rejects invalid connected account IDs', async () => {
    const fakeAccountId = '123e4567-e89b-12d3-a456-426614174999';

    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_connected_account_ids: [fakeAccountId],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('rejects invalid visibility', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_visibility: 'invalid',
      });

    expect(res.status).toBe(400);
  });

  it('handles partial updates', async () => {
    // First set some values
    await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: false,
        default_visibility: 'private',
      });

    // Then update only enabled
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.default_visibility).toBe('private'); // Should remain unchanged
  });
});

