import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cliply/shared', () => ({
  BUCKET_VIDEOS: 'videos',
  SIGNED_URL_TTL_SEC: 300,
}));

const { BUCKET_VIDEOS, SIGNED_URL_TTL_SEC } = await import('@cliply/shared');

import { resetEnvForTesting } from '../../../apps/web/src/lib/env';
import { getSignedUploadUrl } from '../../../apps/web/src/lib/storage';
import * as supabase from '../../../apps/web/src/lib/supabase';

const ORIGINAL_ENV = { ...process.env };
const TEMP_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

describe('storage.getSignedUploadUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetEnvForTesting();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9test',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9test',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9service_role_key_test',
    });
  });

  afterEach(() => {
    for (const key of TEMP_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = ORIGINAL_ENV[key];
      }
    }
    resetEnvForTesting();
    vi.restoreAllMocks();
  });

  it('ensures bucket exists and returns signed URL', async () => {
    const getBucket = vi.fn().mockResolvedValue({ data: null, error: null });
    const createBucket = vi.fn().mockResolvedValue({ data: {}, error: null });

    vi.spyOn(supabase, 'getAdminClient').mockReturnValue({
      storage: {
        getBucket,
        createBucket,
      },
    } as never);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/object/upload/sign/videos/key?token=abc' }),
      text: async () => '',
    } as unknown as Response);

    const key = '/workspace-123/project-456/source.mp4';
    const url = await getSignedUploadUrl(key);

    expect(url).toBe('https://example.supabase.co/storage/v1/object/upload/sign/videos/key?token=abc');
    expect(getBucket).toHaveBeenCalledWith(BUCKET_VIDEOS);
    expect(createBucket).toHaveBeenCalledWith(BUCKET_VIDEOS, { public: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [requestUrl, options] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.toString()).toBe(
      'https://example.supabase.co/storage/v1/object/upload/sign/videos/workspace-123/project-456/source.mp4',
    );
    expect(options?.body).toBe(JSON.stringify({ expiresIn: 300 }));
  });
});
