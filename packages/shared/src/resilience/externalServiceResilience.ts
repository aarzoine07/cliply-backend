import { logger } from "../../logging/logger";

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  maxAttempts: number; // e.g., 3
  baseDelayMs: number; // e.g., 200
  maxDelayMs?: number; // cap backoff (e.g., 10000)
}

/**
 * Error thrown when a service circuit breaker is open
 */
export class ServiceTemporarilyUnavailableError extends Error {
  constructor(serviceName: string) {
    super(`${serviceName} service is temporarily unavailable. Please try again later.`);
    this.name = "ServiceTemporarilyUnavailableError";
  }
}

/**
 * Retry an operation with exponential backoff and jitter.
 * 
 * @param operationName Name of the operation (for logging)
 * @param attempt Function that performs the operation (receives attempt number)
 * @param shouldRetry Function that determines if an error should be retried
 * @param options Retry configuration
 * @returns Result of the operation
 */
export async function withRetry<T>(
  operationName: string,
  attempt: (attemptNumber: number) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs = 10000 } = options;
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      const result = await attempt(attemptNumber);
      
      // Log success on retry (not on first attempt)
      if (attemptNumber > 1) {
        logger.info("external_service_retry_success", {
          service: operationName.split(".")[0] || "unknown",
          operation: operationName,
          attempt: attemptNumber,
          totalAttempts: attemptNumber,
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error)) {
        // Log that we're not retrying
        if (attemptNumber > 1) {
          logger.warn("external_service_retry_aborted", {
            service: operationName.split(".")[0] || "unknown",
            operation: operationName,
            attempt: attemptNumber,
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          });
        }
        throw error;
      }

      // If this was the last attempt, don't wait
      if (attemptNumber >= maxAttempts) {
        logger.error("external_service_retry_exhausted", {
          service: operationName.split(".")[0] || "unknown",
          operation: operationName,
          totalAttempts: maxAttempts,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        });
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);
      const jitter = Math.random() * 0.3 * exponentialDelay; // Up to 30% jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      logger.warn("external_service_retry_attempt", {
        service: operationName.split(".")[0] || "unknown",
        operation: operationName,
        attempt: attemptNumber,
        nextAttempt: attemptNumber + 1,
        maxAttempts,
        delayMs: Math.round(delay),
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        // Include status code if available
        ...(error && typeof error === "object" && "status" in error
          ? { statusCode: (error as { status: number }).status }
          : {}),
      });

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Options for circuit breaker behavior
 */
export interface CircuitBreakerOptions {
  failureThreshold: number; // e.g., 5 failures
  cooldownMs: number; // e.g., 30000 (30s)
  halfOpenMaxAttempts: number; // e.g., 1-3 trial calls
}

/**
 * Circuit breaker for external services
 * Prevents cascading failures by opening the circuit after repeated failures
 */
export interface CircuitBreaker {
  isOpen(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  getState(): CircuitBreakerState;
}

/**
 * Create a circuit breaker instance for a service
 * 
 * @param serviceName Name of the service (for logging)
 * @param options Circuit breaker configuration
 * @returns Circuit breaker instance
 */
export function createCircuitBreaker(
  serviceName: string,
  options: CircuitBreakerOptions,
): CircuitBreaker {
  const { failureThreshold, cooldownMs, halfOpenMaxAttempts } = options;

  let state: CircuitBreakerState = "closed";
  let failureCount = 0;
  let lastFailureTime: number | null = null;
  let halfOpenAttempts = 0;
  let lastStateChangeLog: number | null = null;

  const logStateChange = (newState: CircuitBreakerState, reason: string) => {
    const now = Date.now();
    // Log state changes, but throttle repeated logs while open
    if (newState === "open" && state !== "open") {
      // Opening for the first time
      logger.error("circuit_breaker_opened", {
        service: serviceName,
        state: newState,
        reason,
        failureCount,
        cooldownMs,
      });
      lastStateChangeLog = now;
    } else if (newState === "half-open" && state !== "half-open") {
      // Transitioning to half-open
      logger.info("circuit_breaker_half_open", {
        service: serviceName,
        state: newState,
        reason,
        halfOpenMaxAttempts,
      });
      lastStateChangeLog = now;
    } else if (newState === "closed" && state !== "closed") {
      // Closing (recovered)
      logger.info("circuit_breaker_closed", {
        service: serviceName,
        state: newState,
        reason,
        failureCount: 0,
      });
      lastStateChangeLog = now;
    } else if (newState === "open" && now - (lastStateChangeLog || 0) > 60000) {
      // Log occasionally while open (every 60s)
      logger.warn("circuit_breaker_still_open", {
        service: serviceName,
        state: newState,
        failureCount,
        timeSinceOpen: lastFailureTime ? now - lastFailureTime : null,
      });
      lastStateChangeLog = now;
    }
  };

  return {
    isOpen(): boolean {
      const now = Date.now();

      // Check if we should transition from open to half-open
      if (state === "open" && lastFailureTime && now - lastFailureTime >= cooldownMs) {
        state = "half-open";
        halfOpenAttempts = 0;
        logStateChange("half-open", "cooldown period elapsed");
      }

      return state === "open";
    },

    recordSuccess(): void {
      if (state === "half-open") {
        // Success in half-open state - close the circuit
        state = "closed";
        failureCount = 0;
        halfOpenAttempts = 0;
        lastFailureTime = null;
        logStateChange("closed", "half-open attempt succeeded");
      } else if (state === "closed") {
        // Reset failure count on success (optimistic)
        failureCount = 0;
      }
    },

    recordFailure(): void {
      failureCount++;
      lastFailureTime = Date.now();

      if (state === "half-open") {
        // Failure in half-open - back to open
        state = "open";
        halfOpenAttempts = 0;
        logStateChange("open", "half-open attempt failed");
      } else if (state === "closed" && failureCount >= failureThreshold) {
        // Too many failures - open the circuit
        state = "open";
        logStateChange("open", `failure threshold (${failureThreshold}) reached`);
      } else if (state === "half-open") {
        // Track half-open attempts
        halfOpenAttempts++;
        if (halfOpenAttempts >= halfOpenMaxAttempts) {
          // Too many failures in half-open - back to open
          state = "open";
          halfOpenAttempts = 0;
          logStateChange("open", "half-open max attempts exceeded");
        }
      }
    },

    getState(): CircuitBreakerState {
      // Check if we should transition from open to half-open
      const now = Date.now();
      if (state === "open" && lastFailureTime && now - lastFailureTime >= cooldownMs) {
        state = "half-open";
        halfOpenAttempts = 0;
        logStateChange("half-open", "cooldown period elapsed");
      }

      return state;
    },
  };
}

