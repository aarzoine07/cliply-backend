import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRITICAL: Set NODE_ENV to "test" to enable test-only plan resolution shortcut in buildAuthContext
process.env.NODE_ENV = 'test';

import accountsRoute from '../../apps/web/src/pages/api/accounts';
import accountByIdRoute from '../../apps/web/src/pages/api/accounts/[id]';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof accountsRoute | typeof accountByIdRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

// In-memory Supabase Query Builder Mock
const inMemoryAccounts: Array<Record<string, unknown>> = [];
const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '123e4567-e89b-12d3-a456-426614174001';

function makeQueryBuilder(sourceRows: Array<Record<string, unknown>>) {
  let filtered = [...sourceRows];
  const builder = {
    select(_columns: string) { return builder; },
    eq(col: string, val: unknown) { 
      filtered = filtered.filter((row) => row[col] === val); 
      return builder; 
    },
    order(col: string, options?: { ascending?: boolean }) { 
      const asc = options?.ascending !== false; 
      filtered.sort((a, b) => { 
        if (a[col] === b[col]) return 0; 
        return asc ? (a[col] < b[col] ? -1 : 1) : a[col] > b[col] ? -1 : 1; 
      }); 
      return builder; 
    },
    maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }); },
    single() { 
      const row = filtered[0] ?? null; 
      return row ? Promise.resolve({ data: row, error: null }) : Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } }); 
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === 'connected_accounts') {
        return {
          select(_columns: string) { return makeQueryBuilder(inMemoryAccounts); },
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const rowsArray = Array.isArray(rows) ? rows : [rows];
            const withIds = rowsArray.map((row) => ({
              id: row.id ?? `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
                filtered = filtered.filter((row) => row[col] === val);
                return updateBuilder;
              },
              select: (_columns: string) => {
                const updatedRows: Array<Record<string, unknown>> = [];
                inMemoryAccounts.forEach((acc, idx) => {
                  if (filtered.includes(acc)) {
                    inMemoryAccounts[idx] = { ...acc, ...patch, updated_at: new Date().toISOString() };
                    updatedRows.push(inMemoryAccounts[idx]);
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
              then: (onfulfilled: any, onrejected: any) => {
                inMemoryAccounts.forEach((acc, idx) => {
                  if (filtered.includes(acc)) {
                    inMemoryAccounts[idx] = { ...acc, ...patch, updated_at: new Date().toISOString() };
                  }
                });
                return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
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

beforeEach(() => {
  vi.restoreAllMocks();
  // Clear in-memory accounts before each test
  inMemoryAccounts.length = 0;
});

describe('GET /api/accounts', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('lists connected accounts for workspace', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('accounts');
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  it('filters by platform when provided', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/?platform=youtube')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('accounts');
  });

  it('returns 400 for invalid platform', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/?platform=invalid')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/accounts', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: 'channel-123',
      });
    expect(res.status).toBe(401);
  });

  it('creates a new connected account', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
        handle: '@testchannel',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('platform', 'youtube');
    expect(res.body.data).toHaveProperty('display_name', 'Test Channel');
    expect(res.body.data).toHaveProperty('handle', '@testchannel');
    expect(res.body.data).toHaveProperty('status', 'active');
  });

  it('returns 400 for invalid payload', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'invalid',
      });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/accounts/:id', () => {
  it('returns 401 without session header', async () => {
    const accountId = '123e4567-e89b-12d3-a456-426614174000';
    const mockReq = {
      method: 'PATCH',
      query: { id: accountId },
      body: { status: 'disabled' },
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;
    
    try {
      await accountByIdRoute(mockReq, mockRes);
    } catch (error: any) {
      expect(error.statusCode).toBe(401);
    }
  });

  it('updates account status', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // First create an account
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

    // Then disable it - need to mock req.query.id for dynamic route
    const mockReq = {
      method: 'PATCH',
      query: { id: accountId },
      body: { status: 'disabled' },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;
    
    await accountByIdRoute(mockReq, mockRes);
    
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          success: true,
        }),
      }),
    );
  });

  it('returns 404 for non-existent account', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const accountId = '123e4567-e89b-12d3-a456-426614174999';

    const mockReq = {
      method: 'PATCH',
      query: { id: accountId },
      body: { status: 'disabled' },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;
    
    await accountByIdRoute(mockReq, mockRes);
    
    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 for invalid status', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const accountId = '123e4567-e89b-12d3-a456-426614174000';

    const mockReq = {
      method: 'PATCH',
      query: { id: accountId },
      body: { status: 'invalid' },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;
    
    await accountByIdRoute(mockReq, mockRes);
    
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});

