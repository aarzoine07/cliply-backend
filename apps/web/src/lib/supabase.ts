import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@cliply/shared/env";

const clients: Record<string, SupabaseClient> = {};

const baseAuthConfig = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

// ---------------------------------------------------------------------------
// RLS CLIENT (User / Session Scoped)
// ---------------------------------------------------------------------------
export function getRlsClient(accessToken?: string): SupabaseClient {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase environment variables");
  }

  if (!accessToken) {
    if (!clients.rls) {
      clients.rls = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: baseAuthConfig,
      });
    }
    return clients.rls;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: baseAuthConfig,
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

// ---------------------------------------------------------------------------
// ADMIN CLIENT (Service Role Scoped)
// ---------------------------------------------------------------------------
export function getAdminClient(): SupabaseClient {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase credentials");
  }

  if (!clients.admin) {
    clients.admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: baseAuthConfig,
    });
  }

  return clients.admin;
}

// ---------------------------------------------------------------------------
// TYPE EXPORTS
// ---------------------------------------------------------------------------
export type RlsClient = ReturnType<typeof getRlsClient>;
