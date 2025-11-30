import { beforeEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTesting } from '../../../apps/web/src/lib/env';
import { clearEnvCache } from '@cliply/shared/env';

const ORIGINAL_ENV = { ...process.env };

describe('env', () => {
  beforeEach(() => {
    resetEnvForTesting();
    Object.assign(process.env, ORIGINAL_ENV);
    // Clear cache after restoring env so getEnv() reads fresh values
    clearEnvCache();
  });

  it('parses required vars', () => {
    // Delete SUPABASE_URL to test fallback to NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_URL;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-min-20-chars',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-min-20-chars',
    });
    // Clear cache after setting env vars so getEnv() reads fresh values
    clearEnvCache();

    const env = getEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.SUPABASE_URL).toBe('https://example.supabase.co');
  });

  it('throws when required vars missing', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Clear cache after deleting env vars so getEnv() reads fresh values
    clearEnvCache();

    expect(() => getEnv()).toThrow();
  });
});
