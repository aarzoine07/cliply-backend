/**
 * Shared Supabase client utility for admin scripts
 * Creates a service-role client from environment variables
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client with service role permissions
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment
 * 
 * @throws Error if required environment variables are missing
 */
export function createServiceSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing required environment variables:\n" +
      "  - SUPABASE_URL\n" +
      "  - SUPABASE_SERVICE_ROLE_KEY\n\n" +
      "These are required for admin scripts. " +
      "Ensure your .env file is loaded or set these variables."
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

