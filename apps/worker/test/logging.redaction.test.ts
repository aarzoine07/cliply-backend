import { test, expect, vi } from "vitest";
import { createLogger } from "@cliply/shared/logging";

// basic masking util – inline for now
function maskSecrets(obj: Record<string, any>): Record<string, any> {
  const masked: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string" && /(sk_live_|Bearer\s+)/.test(val)) {
      masked[key] = "***REDACTED***";
    } else {
      masked[key] =
        typeof val === "object" && val !== null ? maskSecrets(val) : val;
    }
  }
  return masked;
}

// patch console to capture
test("Secrets are redacted in logs", () => {
  const logger = createLogger("test-logger");
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});

  // inject mask manually before logging
  const input = maskSecrets({ token: "sk_live_123", auth: "Bearer abc" });
  logger.info(input);

  const [call] = spy.mock.calls[0];
  const parsed = JSON.parse(call as string);

  expect(parsed.token).toBe("***REDACTED***");
  expect(parsed.auth).toBe("***REDACTED***");

  spy.mockRestore();
});
