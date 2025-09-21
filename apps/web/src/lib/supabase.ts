import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getEnv } from './env';

export type RlsClient = SupabaseClient;
export type AdminClient = SupabaseClient;

const baseOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

let cachedAnon: SupabaseClient | null = null;
let cachedAdmin: SupabaseClient | null = null;

export function getRlsClient(accessToken?: string): RlsClient {
  const env = getEnv();

  if (accessToken) {
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      ...baseOptions,
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
  }

  if (!cachedAnon) {
    cachedAnon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, baseOptions);
  }

  return cachedAnon;
}

export function getAdminClient(): AdminClient {
  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  }

  if (!cachedAdmin) {
    cachedAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, baseOptions);
  }

  return cachedAdmin;
}
