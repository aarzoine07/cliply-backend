import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";

import { verifyWorkerEnvironment } from "../../src/lib/envCheck";

// Mock child_process.execFile
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

// Mock logger
vi.mock("@cliply/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("verifyWorkerEnvironment", () => {
  const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

  const REQUIRED_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

  let savedEnv: Record<(typeof REQUIRED_KEYS)[number], string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Save current env so we don't leak between tests
    savedEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  });

  afterEach(() => {
    // Restore env after each test
    for (const key of REQUIRED_KEYS) {
      const v = savedEnv[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  });

  it("returns ok: true when all checks pass", async () => {
    // Set env with all required vars
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile to succeed for both binaries
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          callback(null, { stdout: "version info" }, "");
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(true);
    expect(status.ffmpegOk).toBe(true);
    expect(status.ytDlpOk).toBe(true);
    expect(status.missingEnv).toEqual([]);
  });

  it("detects missing required environment variables", async () => {
    // Missing SUPABASE_URL
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile to succeed
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          callback(null, { stdout: "version info" }, "");
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(false);
    expect(status.missingEnv).toContain("SUPABASE_URL");
    expect(status.missingEnv.length).toBeGreaterThan(0);
  });

  it("detects missing SUPABASE_SERVICE_ROLE_KEY", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Mock execFile to succeed
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          callback(null, { stdout: "version info" }, "");
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(false);
    expect(status.missingEnv).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("detects missing ffmpeg binary (ENOENT)", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile: ffmpeg fails with ENOENT, yt-dlp succeeds
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          if (cmd === "ffmpeg") {
            const error = new Error("ffmpeg not found") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            callback(error, null, "");
          } else if (cmd === "yt-dlp") {
            callback(null, { stdout: "yt-dlp version" }, "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(true); // Still ok because env vars are present
    expect(status.ffmpegOk).toBe(false);
    expect(status.ytDlpOk).toBe(true);
  });

  it("detects missing yt-dlp binary (ENOENT)", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile: ffmpeg succeeds, yt-dlp fails with ENOENT
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          if (cmd === "ffmpeg") {
            callback(null, { stdout: "ffmpeg version" }, "");
          } else if (cmd === "yt-dlp") {
            const error = new Error("yt-dlp not found") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            callback(error, null, "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(true); // Still ok because env vars are present
    expect(status.ffmpegOk).toBe(true);
    expect(status.ytDlpOk).toBe(false);
  });

  it("treats non-ENOENT errors as binary available", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile: ffmpeg fails with non-ENOENT error (binary exists but command failed)
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          if (cmd === "ffmpeg") {
            const error = new Error("ffmpeg command failed") as NodeJS.ErrnoException;
            error.code = "EACCES"; // Permission denied, but binary exists
            callback(error, null, "");
          } else if (cmd === "yt-dlp") {
            callback(null, { stdout: "yt-dlp version" }, "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ffmpegOk).toBe(true);
    expect(status.ytDlpOk).toBe(true);
  });

  it("handles both binaries missing", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile: both binaries fail with ENOENT
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          const error = new Error(`${cmd} not found`) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          callback(error, null, "");
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    expect(status.ok).toBe(true); // Still ok because env vars are present
    expect(status.ffmpegOk).toBe(false);
    expect(status.ytDlpOk).toBe(false);
  });

  it("handles timeout errors gracefully", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-123";

    // Mock execFile: timeout error (binary might exist but took too long)
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], options: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          const error = new Error("Command timed out") as NodeJS.ErrnoException;
          error.code = "ETIMEDOUT";
          callback(error, null, "");
        }
        return {} as ReturnType<typeof execFile>;
      },
    );

    const status = await verifyWorkerEnvironment();

    // Timeout means binary exists but took too long - mark as available
    expect(status.ffmpegOk).toBe(true);
    expect(status.ytDlpOk).toBe(true);
  });
});
