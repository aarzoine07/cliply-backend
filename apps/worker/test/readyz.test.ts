import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSupabaseConnection } from '@cliply/shared/health/readyChecks';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Worker Readiness Checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkSupabaseConnection', () => {
    it('returns ok: true in test mode without network call', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn(),
          }),
        }),
      } as unknown as SupabaseClient;

      const result = await checkSupabaseConnection(mockSupabase, { skipInTest: true });

      expect(result.ok).toBe(true);
      expect(mockSupabase.from).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it('returns ok: false when connection fails', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              error: { message: 'Connection refused' },
            }),
          }),
        }),
      } as unknown as SupabaseClient;

      const result = await checkSupabaseConnection(mockSupabase, { skipInTest: false });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection refused');

      process.env.NODE_ENV = originalEnv;
    });

    it('handles timeout', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(
              () =>
                new Promise((resolve) => {
                  setTimeout(() => resolve({ error: null }), 10000);
                }),
            ),
          }),
        }),
      } as unknown as SupabaseClient;

      const result = await checkSupabaseConnection(mockSupabase, {
        timeoutMs: 100,
        skipInTest: false,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('timeout');

      process.env.NODE_ENV = originalEnv;
    });
  });
});

