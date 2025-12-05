import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvForTesting } from "../../../packages/shared/test/setup";

const ORIGINAL_ENV = { ...process.env };

describe("env", () => {
  beforeEach(() => {
    // Reset any cached env inside the web env module
    resetEnvForTesting();

    // Restore original env snapshot for each test
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("parses required vars", async () => {
    // Force a deterministic Supabase config for this test
    // Note: SUPABASE_ANON_KEY must be at least 20 chars per schema
    const mockAnonKey = "test-anon-key-with-minimum-20-chars";
    const mockServiceRoleKey = "test-service-role-key-minimum-20-chars";
    Object.assign(process.env, {
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: mockAnonKey,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: mockAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: mockServiceRoleKey,
    });

    const { getEnv } = await import("../../../apps/web/src/lib/env");
    const env = getEnv();

    expect(env.NODE_ENV).toBe("test");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    // SUPABASE_URL should match our override, not whatever .env.test had
    expect(env.SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("throws when required vars missing", async () => {
    // Remove all Supabase-related env so validation is guaranteed to fail
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Drop any cached env object
    resetEnvForTesting();

    // Import getEnv from the shared module directly (web adapter has module-level constants
    // that would have been evaluated on first import with different env values)
    const { getEnv } = await import("../../../packages/shared/src/env");

    expect(() => getEnv()).toThrow();
  });
});

