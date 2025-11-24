import { beforeEach, describe, expect, it, vi } from 'vitest';

import readyzRoute from '../../apps/web/src/pages/api/readyz';
import { supertestHandler } from '../utils/supertest-next';
import * as readyChecks from '../../packages/shared/src/health/readyChecks';
import * as supabaseLib from '../../apps/web/src/lib/supabase';

const toApiHandler = (handler: typeof readyzRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe('GET /api/readyz', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when all checks pass', async () => {
    vi.spyOn(readyChecks, 'checkEnvForApi').mockReturnValue({ ok: true });
    vi.spyOn(readyChecks, 'checkSupabaseConnection').mockResolvedValue({ ok: true });
    vi.spyOn(supabaseLib, 'getAdminClient').mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    } as any);

    const res = await supertestHandler(toApiHandler(readyzRoute), 'get').get('/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('service', 'api');
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('env', true);
    expect(res.body.checks).toHaveProperty('db', true);
    expect(res.body).toHaveProperty('ts');
  });

  it('returns 503 when env check fails', async () => {
    vi.spyOn(readyChecks, 'checkEnvForApi').mockReturnValue({
      ok: false,
      missing: ['SUPABASE_URL'],
    });
    vi.spyOn(readyChecks, 'checkSupabaseConnection').mockResolvedValue({ ok: true });

    const res = await supertestHandler(toApiHandler(readyzRoute), 'get').get('/');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('env', false);
    expect(res.body).toHaveProperty('errors');
    expect(res.body.errors).toHaveProperty('env');
  });

  it('returns 503 when DB check fails', async () => {
    vi.spyOn(readyChecks, 'checkEnvForApi').mockReturnValue({ ok: true });
    vi.spyOn(readyChecks, 'checkSupabaseConnection').mockResolvedValue({
      ok: false,
      error: 'connection_timeout',
    });
    vi.spyOn(supabaseLib, 'getAdminClient').mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    } as any);

    const res = await supertestHandler(toApiHandler(readyzRoute), 'get').get('/');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('ok', false);
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('env', true);
    expect(res.body.checks).toHaveProperty('db', false);
    expect(res.body).toHaveProperty('errors');
    expect(res.body.errors).toHaveProperty('db');
  });

  it('skips DB check in test mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    vi.spyOn(readyChecks, 'checkEnvForApi').mockReturnValue({ ok: true });
    vi.spyOn(readyChecks, 'checkSupabaseConnection').mockResolvedValue({ ok: true });

    const res = await supertestHandler(toApiHandler(readyzRoute), 'get').get('/');

    expect(res.status).toBe(200);
    expect(res.body.checks.db).toBe(true);

    process.env.NODE_ENV = originalEnv;
  });
});

