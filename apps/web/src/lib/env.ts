// FILE: apps/web/src/lib/env.ts
// FINAL VERSION – web adapter around @cliply/shared/env

/**
 * Web app environment variable adapter.
 *
 * This module provides type-safe access to environment variables for the Next.js app.
 * - Server-side code (API routes, server components) should use `serverEnv` or `getServerEnv()`
 * - Client-side code should use `publicEnv` (only NEXT_PUBLIC_* variables are exposed)
 *
 * All environment variables are defined in packages/shared/src/env.ts (single source of truth).
 */
import { getEnv as getSharedEnv, type Env } from "@cliply/shared/env";

// Capture original env at module load, so tests can restore to a known baseline
// This snapshot is used by resetEnvForTesting() to restore env state
const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

/**
 * Get server-side environment variables.
 * Use this in API routes, server components, getServerSideProps, etc.
 * Contains all backend env vars from the shared schema.
 *
 * @returns Parsed and validated environment variables
 */
export function getServerEnv(): Env {
  return getSharedEnv();
}

/**
 * Server-side environment variables (lazy accessor).
 * Use this in API routes, server components, getServerSideProps, etc.
 * Contains all backend env vars from the shared schema.
 *
 * This is a convenience accessor that calls getServerEnv() internally.
 */
export const serverEnv: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return getSharedEnv()[prop as keyof Env];
  },
});

/**
 * Client-side safe environment variables.
 * Only NEXT_PUBLIC_* variables are exposed to the browser.
 *
 * Client components should import and use this instead of accessing process.env directly.
 */
export const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TIKTOK_REDIRECT_URL: process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL,
  NEXT_PUBLIC_YOUTUBE_REDIRECT_URL: process.env.NEXT_PUBLIC_YOUTUBE_REDIRECT_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
} as const;

/**
 * Legacy getEnv() function for backward compatibility.
 * @deprecated Use `getServerEnv()` or `serverEnv` instead.
 */
export function getEnv(): Env {
  return getServerEnv();
}

/**
 * Test helper to reset environment variables to a known baseline.
 * This is used in test setup to ensure deterministic env state between tests.
 *
 * @internal This function is only intended for use in tests.
 */
export function resetEnvForTesting(): void {
  // Remove all current keys
  for (const key of Object.keys(process.env)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (process.env as any)[key];
  }

  // Restore original snapshot
  Object.assign(process.env, ORIGINAL_ENV);

  // Clear any cached env in the shared module, if it exists.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const envModule = require("@cliply/shared/env");
    if (envModule && typeof envModule.clearEnvCache === "function") {
      envModule.clearEnvCache();
    }
  } catch {
    // Silently ignore; tests can call clearEnvCache directly if needed.
  }
}
