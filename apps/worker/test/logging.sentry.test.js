import { test, expect, vi } from "vitest";
import { createLogger } from "@cliply/shared/logging";
test("Sentry hook dry run logs error shape", () => {
    const logger = createLogger("test-logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => { });
    logger.error({
        msg: "boom",
        err: { name: "Error", message: "x", stack: "stacktrace..." },
    });
    const [call] = spy.mock.calls[0];
    const parsed = JSON.parse(call);
    expect(parsed.level).toBe("error");
    expect(parsed.component).toBe("test-logger");
    expect(parsed.err?.message).toBe("x");
    expect(parsed.msg).toBe("boom");
    spy.mockRestore();
});
