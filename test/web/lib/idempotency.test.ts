import { beforeEach, describe, expect, it, vi } from 'vitest';

import { keyFromRequest, withIdempotency } from '../../../apps/web/src/lib/idempotency';
import * as supabase from '../../../apps/web/src/lib/supabase';

describe('withIdempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a new record and marks it as completed', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const exec = vi.fn().mockResolvedValue('value');
    const key = keyFromRequest({ method: 'POST', url: '/api/demo', body: { foo: 'bar' } });

    const result = await withIdempotency(key, exec);

    expect(result.fresh).toBe(true);
    if (result.fresh) {
      expect(result.value).toBe('value');
      expect(result.responseHash).toHaveLength(64);
    }
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns cached result when completed record exists', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const key = keyFromRequest({ method: 'POST', url: '/api/demo', body: { foo: 'bar' } });

    const exec = vi.fn().mockResolvedValue('initial');
    await withIdempotency(key, exec);
    expect(exec).toHaveBeenCalledTimes(1);

    const secondExec = vi.fn();
    const second = await withIdempotency(key, secondExec);

    expect(second.fresh).toBe(false);
    if (!second.fresh) {
      expect(second.responseHash === null || second.responseHash.length === 64).toBe(true);
    }
    expect(secondExec).not.toHaveBeenCalled();
  });
});

type IdempotencyRecord = {
  status: string;
  response_hash: string | null;
};

type AdminMock = {
  store: Map<string, IdempotencyRecord>;
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function createAdminMock(): AdminMock {
  const store = new Map<string, IdempotencyRecord>();

  const admin: AdminMock = {
    store,
    rpc: vi.fn().mockResolvedValue({ data: 10, error: null }),
    from: vi.fn((table: string) => {
      if (table !== 'idempotency') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () => ({ data: store.get(key) ?? null, error: null }),
          }),
        }),
        upsert: async (payload: { key: string; status: string; response_hash?: string | null }) => {
          store.set(payload.key, {
            status: payload.status,
            response_hash: payload.response_hash ?? null,
          });
          return { data: null, error: null };
        },
      };
    }),
  };

  return admin;
}

function mockAdminClient(admin: AdminMock) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as never);
}
