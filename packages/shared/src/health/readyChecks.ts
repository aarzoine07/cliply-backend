import { getEnv } from "../env";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Check if required environment variables for API are present
 */
export function checkEnvForApi(): { ok: boolean; missing?: string[] } {
  try {
    const env = getEnv();
    const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
    const missing: string[] = [];

    for (const key of required) {
      const value = env[key];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missing.push(key);
      }
    }

    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  } catch (error) {
    // getEnv() throws if validation fails
    return { ok: false, missing: ["ENV_VALIDATION_FAILED"] };
  }
}

/**
 * Check if required environment variables for worker are present
 */
export function checkEnvForWorker(): { ok: boolean; missing?: string[] } {
  try {
    const env = getEnv();
    const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
    const missing: string[] = [];

    for (const key of required) {
      const value = env[key];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missing.push(key);
      }
    }

    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  } catch (error) {
    // getEnv() throws if validation fails
    return { ok: false, missing: ["ENV_VALIDATION_FAILED"] };
  }
}

/**
 * Check Supabase connection with a minimal query
 * Safe for test mode (returns success without network call if NODE_ENV === "test")
 */
export async function checkSupabaseConnection(
  supabase: SupabaseClient,
  options?: { timeoutMs?: number; skipInTest?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const { timeoutMs = 5000, skipInTest = true } = options || {};

  // In test mode, skip actual network calls
  if (skipInTest && process.env.NODE_ENV === "test") {
    return { ok: true };
  }

  try {
    // Use Promise.race to enforce timeout
    const checkPromise = supabase.from("jobs").select("id").limit(1);
    const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) => {
      setTimeout(() => resolve({ ok: false, error: "timeout" }), timeoutMs);
    });

    const result = await Promise.race([checkPromise, timeoutPromise]);

    if ("ok" in result && !result.ok) {
      return result;
    }

    const { error } = result as { error?: { message?: string } | null };
    if (error) {
      return { ok: false, error: error.message || "database_error" };
    }

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

