import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withRetry, createCircuitBreaker, ServiceTemporarilyUnavailableError } from "../../packages/shared/src/resilience/externalServiceResilience";
import type { RetryOptions, CircuitBreakerOptions } from "../../packages/shared/src/resilience/externalServiceResilience";

// Mock logger to avoid console output in tests
vi.mock("../../packages/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("externalServiceResilience", () => {
  describe("withRetry", () => {

    it("succeeds on first attempt without retrying", async () => {
      const attempt = vi.fn().mockResolvedValue("success");

      const result = await withRetry(
        "test.operation",
        attempt,
        () => true,
        { maxAttempts: 3, baseDelayMs: 100 },
      );

      expect(result).toBe("success");
      expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable errors and succeeds", async () => {
      let attemptCount = 0;
      const attempt = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Transient error");
        }
        return "success";
      });

      const result = await withRetry(
        "test.operation",
        attempt,
        () => true, // Always retry
        { maxAttempts: 3, baseDelayMs: 100 },
      );

      expect(result).toBe("success");
      expect(attempt).toHaveBeenCalledTimes(3);
    });

    it("stops immediately on non-retryable errors", async () => {
      const attempt = vi.fn().mockRejectedValue(new Error("Permanent error"));

      await expect(
        withRetry(
          "test.operation",
          attempt,
          () => false, // Never retry
          { maxAttempts: 3, baseDelayMs: 100 },
        ),
      ).rejects.toThrow("Permanent error");

      expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("exhausts retries and throws last error", async () => {
      const attempt = vi.fn().mockRejectedValue(new Error("Transient error"));

      await expect(
        withRetry(
          "test.operation",
          attempt,
          () => true, // Always retry
          { maxAttempts: 3, baseDelayMs: 100 },
        ),
      ).rejects.toThrow("Transient error");

      expect(attempt).toHaveBeenCalledTimes(3);
    });

    it("applies exponential backoff with jitter", async () => {
      const attempt = vi.fn().mockRejectedValue(new Error("Transient error"));
      const startTime = Date.now();

      await expect(
        withRetry(
          "test.operation",
          attempt,
          () => true,
          { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 200 }, // Small delays for test
        ),
      ).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      // Should have waited for retries (at least some delay)
      expect(elapsed).toBeGreaterThan(50);
      expect(attempt).toHaveBeenCalledTimes(3);
    }, 10000); // Increase timeout for this test
  });

  describe("createCircuitBreaker", () => {
    it("starts in closed state", () => {
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      expect(breaker.getState()).toBe("closed");
      expect(breaker.isOpen()).toBe(false);
    });

    it("opens after failure threshold is reached", () => {
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      // Record failures up to threshold
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("closed");

      breaker.recordFailure(); // Third failure
      expect(breaker.getState()).toBe("open");
      expect(breaker.isOpen()).toBe(true);
    });

    it("stays open during cooldown period", () => {
      vi.useFakeTimers();
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 2,
        cooldownMs: 5000,
        halfOpenMaxAttempts: 1,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance time but not enough
      vi.advanceTimersByTime(3000);
      expect(breaker.getState()).toBe("open");

      vi.useRealTimers();
    });

    it("transitions to half-open after cooldown", () => {
      vi.useFakeTimers();
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 2,
        cooldownMs: 5000,
        halfOpenMaxAttempts: 1,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance time past cooldown
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe("half-open");
      expect(breaker.isOpen()).toBe(false);

      vi.useRealTimers();
    });

    it("closes circuit on success in half-open state", () => {
      vi.useFakeTimers();
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 2,
        cooldownMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance to half-open
      vi.advanceTimersByTime(1000);
      expect(breaker.getState()).toBe("half-open");

      // Success in half-open
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("closed");

      vi.useRealTimers();
    });

    it("reopens circuit on failure in half-open state", () => {
      vi.useFakeTimers();
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 2,
        cooldownMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance to half-open
      vi.advanceTimersByTime(1000);
      expect(breaker.getState()).toBe("half-open");

      // Failure in half-open
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      vi.useRealTimers();
    });

    it("resets failure count on success in closed state", () => {
      const breaker = createCircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess(); // Success resets count
      breaker.recordFailure(); // Should still be closed (only 1 failure now)
      expect(breaker.getState()).toBe("closed");
    });
  });

  describe("ServiceTemporarilyUnavailableError", () => {
    it("creates error with service name", () => {
      const error = new ServiceTemporarilyUnavailableError("YouTube");
      expect(error.message).toContain("YouTube");
      expect(error.name).toBe("ServiceTemporarilyUnavailableError");
    });
  });
});

