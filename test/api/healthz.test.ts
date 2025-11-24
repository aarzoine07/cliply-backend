import { describe, expect, it } from 'vitest';

import healthzRoute from '../../apps/web/src/pages/api/healthz';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof healthzRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe('GET /api/healthz', () => {
  it('returns 200 with correct shape', async () => {
    const res = await supertestHandler(toApiHandler(healthzRoute), 'get').get('/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('service', 'api');
    expect(res.body).toHaveProperty('ts');
    expect(typeof res.body.ts).toBe('string');
    // Should be a valid ISO timestamp
    expect(() => new Date(res.body.ts)).not.toThrow();
  });

  it('is lightweight and fast', async () => {
    const start = Date.now();
    const res = await supertestHandler(toApiHandler(healthzRoute), 'get').get('/');
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // Should be very fast (no external calls)
    expect(elapsed).toBeLessThan(100);
  });
});

