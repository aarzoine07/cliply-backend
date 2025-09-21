import { beforeEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTesting } from '../../../apps/web/src/lib/env';

const ORIGINAL_ENV = { ...process.env };

describe('env', () => {
  beforeEach(() => {
    resetEnvForTesting();
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('parses required vars', () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    });

    const env = getEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.SUPABASE_URL).toBe('https://example.supabase.co');
  });

  it('throws when required vars missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    resetEnvForTesting();

    expect(() => getEnv()).toThrow();
  });
});
