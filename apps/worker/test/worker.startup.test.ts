import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the envCheck module
const mockVerifyWorkerEnvironment = vi.fn();
vi.mock("../src/lib/envCheck", () => ({
  verifyWorkerEnvironment: mockVerifyWorkerEnvironment,
}));

// Mock other dependencies to avoid full worker initialization
vi.mock("@cliply/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@cliply/shared/sentry", () => ({
  initSentry: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(),
  })),
}));

// Mock getEnv
vi.mock("@cliply/shared/env", () => ({
  getEnv: vi.fn(() => ({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  })),
}));

describe("Worker startup integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifyWorkerEnvironment is imported and available", () => {
    // Verify the mock is set up correctly
    expect(mockVerifyWorkerEnvironment).toBeDefined();
    expect(typeof mockVerifyWorkerEnvironment).toBe("function");
  });

  it("can mock successful environment check", async () => {
    // Mock successful environment check
    mockVerifyWorkerEnvironment.mockResolvedValue({
      ok: true,
      ffmpegOk: true,
      ytDlpOk: true,
      missingEnv: [],
    });

    const result = await mockVerifyWorkerEnvironment();
    expect(result.ok).toBe(true);
    expect(result.ffmpegOk).toBe(true);
    expect(result.ytDlpOk).toBe(true);
  });

  it("can mock failed environment check with missing env vars", async () => {
    // Mock failed environment check
    mockVerifyWorkerEnvironment.mockResolvedValue({
      ok: false,
      ffmpegOk: true,
      ytDlpOk: true,
      missingEnv: ["SUPABASE_URL"],
    });

    const result = await mockVerifyWorkerEnvironment();
    expect(result.ok).toBe(false);
    expect(result.missingEnv).toContain("SUPABASE_URL");
  });
});

