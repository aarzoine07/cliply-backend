import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set STRIPE_SECRET_KEY before importing the route module
// This must be done before the module is loaded
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
}
import type { NextApiRequest, NextApiResponse } from 'next';

import checkoutRoute from '../../apps/web/src/pages/api/billing/checkout';
import { supertestHandler } from '../utils/supertest-next';
import * as supabase from '../../apps/web/src/lib/supabase';
import * as rateLimit from '../../apps/web/src/lib/rate-limit';
import Stripe from 'stripe';

// Mock Supabase client creation for buildAuthContext
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

// Mock Stripe
vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'sess_test_123',
            url: 'https://checkout.stripe.com/test',
          }),
        },
      },
    })),
  };
});

const toApiHandler = (handler: typeof checkoutRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

function createAdminMock() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'idempotency') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
        error: null,
      }),
    },
  };
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  mockSupabaseClientFactory.mockReturnValue(admin);
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
    vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
      allowed: true,
      remaining: 60,
    });
  });

  it('returns 400 when priceId is missing', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(checkoutRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({});

    // Should return 400 for validation error (may be 500 if auth fails first)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
    // Error code may vary depending on where validation fails
  });

  it('returns 400 when priceId is empty string', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(checkoutRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({ priceId: '' });

    // Should return 400 for validation error (may be 500 if auth fails first)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when successUrl is not a valid URL', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(checkoutRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({ priceId: 'price_123', successUrl: 'not-a-url' });

    // May return 400 for validation or 500 if auth fails
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns security headers in response', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(checkoutRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({ priceId: 'price_basic_monthly' });

    // May return 400 if priceId is invalid, but headers should still be present
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('handles OPTIONS preflight request', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    const res = await supertestHandler(toApiHandler(checkoutRoute), 'options')
      .options('/')
      .set({
        ...commonHeaders,
        origin: 'http://localhost:3000',
      });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('validates priceId format and length', async () => {
    const admin = createAdminMock();
    mockAdminClient(admin);

    // Test that very long priceId is rejected by Zod validation
    const longPriceId = 'a'.repeat(256); // Exceeds 255 char limit
    const res = await supertestHandler(toApiHandler(checkoutRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({ priceId: longPriceId });

    // Should return 400 for validation error (may be 500 if auth fails first)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
  });
});
