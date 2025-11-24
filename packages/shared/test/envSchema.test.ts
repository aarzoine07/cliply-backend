import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { EnvSchema, getEnv, clearEnvCache } from "../src/env";

describe("envSchema", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Clear cache before tests
    clearEnvCache();
  });

  afterAll(() => {
    // Restore original env
    process.env = originalEnv;
    clearEnvCache();
  });

  describe("validation", () => {
    it("validates required variables", () => {
      // Set up minimal required env
      process.env.NODE_ENV = "development";
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key-base64-encoded-32-bytes-length-here";

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SUPABASE_URL).toBe("https://test.supabase.co");
        expect(result.data.TIKTOK_ENCRYPTION_KEY).toBe("test-key-base64-encoded-32-bytes-length-here");
      }
    });

    it("throws error when required variables are missing", () => {
      // Remove required vars
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.TIKTOK_ENCRYPTION_KEY;

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(false);
      if (!result.success) {
        const missing = result.error.issues.map((i) => i.path.join("."));
        expect(missing).toContain("SUPABASE_URL");
        expect(missing).toContain("SUPABASE_ANON_KEY");
        expect(missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
        expect(missing).toContain("TIKTOK_ENCRYPTION_KEY");
      }
    });

    it("validates URL format for SUPABASE_URL", () => {
      process.env.SUPABASE_URL = "not-a-url";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(false);
      if (!result.success) {
        const urlIssue = result.error.issues.find((i) => i.path.includes("SUPABASE_URL"));
        expect(urlIssue).toBeTruthy();
        expect(urlIssue?.message).toContain("URL");
      }
    });

    it("validates minimum length for SUPABASE_ANON_KEY", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "short";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(false);
      if (!result.success) {
        const keyIssue = result.error.issues.find((i) => i.path.includes("SUPABASE_ANON_KEY"));
        expect(keyIssue).toBeTruthy();
        expect(keyIssue?.message).toContain("20");
      }
    });

    it("validates minimum length for SUPABASE_SERVICE_ROLE_KEY", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "short";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(false);
      if (!result.success) {
        const keyIssue = result.error.issues.find((i) => i.path.includes("SUPABASE_SERVICE_ROLE_KEY"));
        expect(keyIssue).toBeTruthy();
        expect(keyIssue?.message).toContain("20");
      }
    });

    it("allows optional variables to be missing", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      // Don't set optional vars
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.DEEPGRAM_API_KEY;
      delete process.env.CRON_SECRET;

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(true);
    });

    it("uses default values where specified", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      delete process.env.NODE_ENV;
      delete process.env.LOG_SAMPLE_RATE;
      delete process.env.SENTRY_DSN;

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe("development");
        expect(result.data.LOG_SAMPLE_RATE).toBe("1");
        expect(result.data.SENTRY_DSN).toBe("");
      }
    });
  });

  describe("getEnv()", () => {
    it("caches parsed result", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      clearEnvCache();

      const env1 = getEnv();
      const env2 = getEnv();

      // Should return same instance (cached)
      expect(env1).toBe(env2);
    });

    it("throws descriptive error when validation fails", () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.TIKTOK_ENCRYPTION_KEY;

      clearEnvCache();

      expect(() => {
        getEnv();
      }).toThrow("Environment variable validation failed");
    });
  });

  describe("NODE_ENV", () => {
    it("accepts valid NODE_ENV values", () => {
      const validValues = ["development", "test", "production"];

      for (const value of validValues) {
        process.env.NODE_ENV = value;
        process.env.SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
        process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

        clearEnvCache();

        const result = EnvSchema.safeParse(process.env);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.NODE_ENV).toBe(value);
        }
      }
    });

    it("rejects invalid NODE_ENV values", () => {
      process.env.NODE_ENV = "invalid";
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test1234567890";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service1234567890";
      process.env.TIKTOK_ENCRYPTION_KEY = "test-key";

      clearEnvCache();

      const result = EnvSchema.safeParse(process.env);
      expect(result.success).toBe(false);
    });
  });
});

