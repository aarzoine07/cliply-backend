import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BillingErrorCode } from "../../types/billing";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Checks rate limit for a specific workspace and feature.
 * Throws BILLING_RATE_LIMITED when tokens are exhausted.
 */
export async function checkRateLimit(workspace_id: string, feature: string): Promise<void> {
  // Call Supabase RPC to consume a token from the bucket (if available).
  const { data, error } = await supabase.rpc("fn_consume_token", {
    p_workspace_id: workspace_id,
    p_feature: feature,
  });

  if (error) {
    throw {
      code: BillingErrorCode.RATE_LIMITED,
      message: `Rate limit check failed for ${feature}: ${error.message}`,
      status: 500,
    };
  }

  // When the RPC returns explicit false, tokens are depleted for this period.
  if (data === false) {
    throw {
      code: BillingErrorCode.RATE_LIMITED,
      message: `Rate limit exceeded for ${feature}. Please wait before retrying.`,
      status: 429,
    };
  }
}
