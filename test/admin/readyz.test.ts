import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@cliply/shared/env", async () => {
  const actual = await vi.importActual<typeof import("@cliply/shared/env")>("@cliply/shared/env");
  return {
    ...actual,
    getEnv: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("stripe", () => {
  return {
    default: vi.fn(),
  };
});

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as envModule from "@cliply/shared/env";

describe("buildBackendReadinessReport", () => {
  const mockGetEnv = vi.fn();
  const mockSupabaseClient = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock implementations
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabaseClient);
    (Stripe as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({}));
    vi.spyOn(envModule, "getEnv").mockImplementation(mockGetEnv);
  });

  it("returns ok: true when all checks pass", async () => {
    // Mock env with all required vars
    mockGetEnv.mockReturnValue({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      SENTRY_DSN: "https://test@sentry.io/123",
    });

    // Mock Supabase client to succeed
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ error: null })),
      })),
    });

    const report = await buildBackendReadinessReport();

    expect(report.ok).toBe(true);
    expect(report.env.ok).toBe(true);
    expect(report.env.missing).toEqual([]);
    expect(report.db.ok).toBe(true);
    expect(report.stripe.ok).toBe(true);
    expect(report.sentry.ok).toBe(true);
  });

  it("detects missing required environment variables", async () => {
    // Mock env missing SUPABASE_URL
    mockGetEnv.mockReturnValue({
      SUPABASE_ANON_KEY: "test-anon-key",
      // SUPABASE_URL missing
    });

    const report = await buildBackendReadinessReport();

    expect(report.ok).toBe(false);
    expect(report.env.ok).toBe(false);
    expect(report.env.missing).toContain("SUPABASE_URL");
  });

  it("handles database connection failure", async () => {
    // Mock env with all required vars
    mockGetEnv.mockReturnValue({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    });

    // Mock Supabase client to fail
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ error: { message: "Connection failed" } })),
      })),
    });

    const report = await buildBackendReadinessReport();

    expect(report.ok).toBe(false);
    expect(report.db.ok).toBe(false);
    expect(report.db.error).toBeDefined();
  });

  it("detects missing Stripe configuration", async () => {
    // Mock env missing Stripe vars
    mockGetEnv.mockReturnValue({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      // STRIPE_SECRET_KEY missing
      // STRIPE_WEBHOOK_SECRET missing
    });

    // Mock Supabase to succeed
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ error: null })),
      })),
    });

    const report = await buildBackendReadinessReport();

    expect(report.stripe.ok).toBe(false);
    expect(report.stripe.missingEnv.length).toBeGreaterThan(0);
  });

  it("includes worker status when provided", async () => {
    // Mock env with all required vars
    mockGetEnv.mockReturnValue({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    });

    // Mock Supabase to succeed
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ error: null })),
      })),
    });

    const workerStatus = {
      ok: true,
      ffmpegOk: true,
      ytDlpOk: true,
      missingEnv: [],
    };

    const report = await buildBackendReadinessReport({
      includeWorkerEnv: true,
      workerStatus,
    });

    expect(report.worker).toBeDefined();
    expect(report.worker?.ok).toBe(true);
    expect(report.worker?.ffmpegOk).toBe(true);
    expect(report.worker?.ytDlpOk).toBe(true);
  });

  it("reports missing tables when they don't exist", async () => {
    // Mock env with all required vars
    mockGetEnv.mockReturnValue({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    });

    // Mock Supabase: workspaces exists, jobs doesn't
    let callCount = 0;
    mockSupabaseClient.from.mockImplementation((table: string) => {
      callCount++;
      if (table === "workspaces" || callCount === 1) {
        // First call (workspaces) succeeds
        return {
          select: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ error: null })),
          })),
        };
      } else {
        // Other tables don't exist
        return {
          select: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve({
                error: { message: "relation does not exist", code: "PGRST116" },
              })
            ),
          })),
        };
      }
    });

    const report = await buildBackendReadinessReport();

    expect(report.db.ok).toBe(false);
    expect(report.db.missingTables.length).toBeGreaterThan(0);
  });
});

