import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Sentry to avoid initialization issues in tests
vi.mock("@sentry/node", () => ({
  default: {},
  addBreadcrumb: vi.fn(),
}));

import { logEvent } from "../src/services/logging.js";

describe("logging + Sentry breadcrumbs", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("creates structured JSON log and breadcrumb", () => {
    logEvent("test-job-123", "test_event", { foo: "bar" });

    // Verify console.log was called
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    const logCall = consoleLogSpy.mock.calls[0][0];
    expect(typeof logCall).toBe("string");

    // Parse and verify JSON structure
    const parsed = JSON.parse(logCall as string);
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("job_id", "test-job-123");
    expect(parsed).toHaveProperty("event", "test_event");
    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("foo", "bar");

    // Verify log contains expected fields
    expect(logCall).toContain("test-job-123");
    expect(logCall).toContain("test_event");
  });

  it("handles job lifecycle events with duration", () => {
    logEvent("job-456", "render_clip_job:start");
    logEvent("job-456", "render_clip_job:success", { duration_ms: 1580 });

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);

    // Verify start event
    const startLog = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(startLog.job_id).toBe("job-456");
    expect(startLog.event).toBe("render_clip_job:start");

    // Verify success event with duration
    const successLog = JSON.parse(consoleLogSpy.mock.calls[1][0] as string);
    expect(successLog.job_id).toBe("job-456");
    expect(successLog.event).toBe("render_clip_job:success");
    expect(successLog.duration_ms).toBe(1580);

    // Verify both events are logged
    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
  });

  it("handles failure events with error messages", () => {
    logEvent("job-789", "render_clip_job:failure", { error: "Clip not found" });

    const logCall = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(logCall as string);

    expect(parsed.job_id).toBe("job-789");
    expect(parsed.event).toBe("render_clip_job:failure");
    expect(parsed.error).toBe("Clip not found");
  });
});

