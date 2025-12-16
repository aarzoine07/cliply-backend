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

/**
 * Queue health status result
 */
export type QueueHealthResult = {
  ok: boolean;
  length: number;
  oldestJobAge: number | null;
  warning: boolean;
  critical: boolean;
  error?: string;
};

/**
 * Check queue health by querying job counts and oldest job age.
 * Safe for test mode (returns mock success if NODE_ENV === "test")
 */
export async function checkQueueHealth(
  supabase: SupabaseClient,
  options?: { 
    timeoutMs?: number; 
    skipInTest?: boolean;
    warningThresholdMs?: number;
    criticalThresholdMs?: number;
  },
): Promise<QueueHealthResult> {
  const { 
    timeoutMs = 5000, 
    skipInTest = true,
    warningThresholdMs = 60_000,
    criticalThresholdMs = 300_000,
  } = options || {};

  // In test mode, return mock success
  if (skipInTest && process.env.NODE_ENV === "test") {
    return { 
      ok: true, 
      length: 0, 
      oldestJobAge: null, 
      warning: false, 
      critical: false,
    };
  }

  try {
    // Use Promise.race to enforce timeout
    const checkPromise = (async () => {
      // Get count of queued jobs
      const { count, error: countError } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");

      if (countError) {
        return {
          ok: false,
          length: 0,
          oldestJobAge: null,
          warning: false,
          critical: false,
          error: countError.message,
        };
      }

      // Get oldest queued job
      const { data: oldestJob, error: oldestError } = await supabase
        .from("jobs")
        .select("created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      let oldestJobAge: number | null = null;
      if (!oldestError && oldestJob?.created_at) {
        oldestJobAge = Date.now() - new Date(oldestJob.created_at).getTime();
      }

      const warning = oldestJobAge !== null && oldestJobAge > warningThresholdMs;
      const critical = oldestJobAge !== null && oldestJobAge > criticalThresholdMs;

      return {
        ok: !critical,
        length: count ?? 0,
        oldestJobAge,
        warning,
        critical,
      };
    })();

    const timeoutPromise = new Promise<QueueHealthResult>((resolve) => {
      setTimeout(() => resolve({ 
        ok: false, 
        length: 0, 
        oldestJobAge: null, 
        warning: false,
        critical: false,
        error: "timeout",
      }), timeoutMs);
    });

    return await Promise.race([checkPromise, timeoutPromise]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { 
      ok: false, 
      length: 0, 
      oldestJobAge: null, 
      warning: false, 
      critical: false,
      error: message,
    };
  }
}

