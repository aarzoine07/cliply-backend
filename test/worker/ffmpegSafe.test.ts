import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { runFfmpegSafely } from "../../apps/worker/src/lib/ffmpegSafe";
import type { LoggerLike } from "../../apps/worker/src/pipelines/types";

// Mock child_process.spawn
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(),
  };
});

describe("FFmpeg Safety Wrapper", () => {
  let mockLogger: LoggerLike;
  let mockChildProcess: {
    stderr: { setEncoding: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
    stdout: { setEncoding: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
    once: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Create mock child process
    const stderrOn = vi.fn();
    const stdoutOn = vi.fn();
    mockChildProcess = {
      stderr: {
        setEncoding: vi.fn(),
        on: stderrOn,
      },
      stdout: {
        setEncoding: vi.fn(),
        on: stdoutOn,
      },
      once: vi.fn(),
      kill: vi.fn(),
      killed: false,
    };

    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChildProcess);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return success result when FFmpeg exits with code 0", async () => {
    // Setup: simulate successful FFmpeg execution
    const stderrData = "Duration: 00:01:30.00\n[some ffmpeg output]";
    mockChildProcess.stderr.on.mockImplementation((event: string, handler: (data: string) => void) => {
      if (event === "data") {
        // Simulate stderr data
        setTimeout(() => handler(stderrData), 10);
      }
    });
    mockChildProcess.stdout.on.mockImplementation(() => {});

    mockChildProcess.once.mockImplementation((event: string, handler: (code: number) => void) => {
      if (event === "close") {
        setTimeout(() => handler(0), 50);
      }
    });

    const result = await runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      logger: mockLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSeconds).toBe(90); // 1:30 = 90 seconds
      expect(result.stderrSummary).toBeTruthy();
    }
    expect(mockLogger.info).toHaveBeenCalledWith(
      "ffmpeg_completed",
      expect.objectContaining({
        inputPath: "/tmp/input.mp4",
        outputPath: "/tmp/output.mp4",
      }),
    );
  });

  it("should return error result when FFmpeg exits with non-zero code", async () => {
    const stderrData = "Error: Invalid input file\n[error details]";
    mockChildProcess.stderr.on.mockImplementation((event: string, handler: (data: string) => void) => {
      if (event === "data") {
        setTimeout(() => handler(stderrData), 10);
      }
    });
    mockChildProcess.stdout.on.mockImplementation(() => {});

    mockChildProcess.once.mockImplementation((event: string, handler: (code: number) => void) => {
      if (event === "close") {
        setTimeout(() => handler(1), 50);
      }
    });

    const result = await runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      logger: mockLogger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("EXIT_CODE");
      expect(result.exitCode).toBe(1);
      expect(result.stderrSummary).toContain("Error");
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      "ffmpeg_failed",
      expect.objectContaining({
        exitCode: 1,
        inputPath: "/tmp/input.mp4",
      }),
    );
  });

  it("should timeout and kill process when timeout is exceeded", async () => {
    // Setup: process never closes (simulating hang)
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.stdout.on.mockImplementation(() => {});
    // Don't call the close handler - simulate hanging process
    mockChildProcess.once.mockImplementation(() => {
      // Never resolve - simulate hang
    });

    const resultPromise = runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      timeoutMs: 100, // Very short timeout for test
      logger: mockLogger,
    });

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("TIMEOUT");
      expect(result.signal).toBe("SIGKILL");
    }
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "ffmpeg_timeout",
      expect.objectContaining({
        timeoutMs: 100,
      }),
    );
  }, 1000); // Increase test timeout

  it("should handle spawn errors", async () => {
    // Setup: spawn throws an error
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("ffmpeg not found");
    });

    const result = await runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      logger: mockLogger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("SPAWN_ERROR");
      expect(result.stderrSummary).toContain("ffmpeg not found");
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      "ffmpeg_spawn_error",
      expect.objectContaining({
        error: "ffmpeg not found",
      }),
    );
  });

  it("should extract duration from stderr output", async () => {
    const stderrData = "Duration: 00:05:23.45\n[other output]";
    mockChildProcess.stderr.on.mockImplementation((event: string, handler: (data: string) => void) => {
      if (event === "data") {
        setTimeout(() => handler(stderrData), 10);
      }
    });
    mockChildProcess.stdout.on.mockImplementation(() => {});

    mockChildProcess.once.mockImplementation((event: string, handler: (code: number) => void) => {
      if (event === "close") {
        setTimeout(() => handler(0), 50);
      }
    });

    const result = await runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      logger: mockLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 5 minutes 23.45 seconds = 323.45 seconds
      expect(result.durationSeconds).toBeCloseTo(323.45, 2);
    }
  });

  it("should use default timeout when not specified", async () => {
    const stderrData = "Duration: 00:01:00.00\n";
    mockChildProcess.stderr.on.mockImplementation((event: string, handler: (data: string) => void) => {
      if (event === "data") {
        setTimeout(() => handler(stderrData), 10);
      }
    });
    mockChildProcess.stdout.on.mockImplementation(() => {});

    mockChildProcess.once.mockImplementation((event: string, handler: (code: number) => void) => {
      if (event === "close") {
        setTimeout(() => handler(0), 50);
      }
    });

    await runFfmpegSafely({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      args: ["-i", "/tmp/input.mp4", "/tmp/output.mp4"],
      logger: mockLogger,
    });

    // Verify timeout was set (check that setTimeout was called with default timeout)
    // This is indirect - we just verify the function completes successfully
    expect(mockChildProcess.once).toHaveBeenCalled();
  });
});

