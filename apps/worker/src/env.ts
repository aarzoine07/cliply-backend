/**
 * Worker environment variable adapter.
 * 
 * This module re-exports the shared environment schema for use in the worker service.
 * All environment variables are defined in packages/shared/src/env.ts (single source of truth).
 * 
 * Worker code should import env or getEnv from this module instead of accessing process.env directly.
 */
import { getEnv as getSharedEnv, type Env } from "@cliply/shared/env";

/**
 * Get parsed and validated environment variables for the worker service.
 * 
 * @returns Parsed and validated environment variables
 */
export function getEnv(): Env {
  return getSharedEnv();
}

/**
 * Parsed and validated environment variables for the worker service.
 * 
 * Access env.FOO instead of process.env.FOO for type safety and validation.
 * This is a convenience accessor that calls getEnv() internally.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return getSharedEnv()[prop as keyof Env];
  },
});

/**
 * Re-export the Env type for convenience.
 */
export type { Env };

