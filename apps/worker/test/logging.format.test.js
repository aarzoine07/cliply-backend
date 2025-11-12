// @ts-nocheck
import { test, expect } from "vitest";
import { createLogger } from "@cliply/shared/logging";
test("Structured JSON logger outputs correct format", async () => {
    const logger = createLogger("test-logger");
    const logs = [];
    // temporarily override console.log to capture output
    const originalLog = console.log;
    console.log = (msg) => logs.push(msg);
    // simulate a log event
    logger.info("Worker started", { jobId: "123", status: "queued" });
    // restore console.log
    console.log = originalLog;
    // parse captured log
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("msg", "Worker started");
    expect(parsed).toHaveProperty("context.jobId", "123");
    expect(parsed).toHaveProperty("context.status", "queued");
    expect(parsed).toHaveProperty("timestamp");
});
