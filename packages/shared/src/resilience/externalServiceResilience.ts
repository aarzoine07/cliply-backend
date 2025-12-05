// packages/shared/src/resilience/externalServiceResilience.ts

/**
 * Simple retry helper for wrapping external service calls (e.g. Stripe, webhooks).
 * 
 * This intentionally has:
 * - no external deps
 * - predictable behaviour
 * - a small, well-typed API
 */

export interface WithRetryOptions {
    /**
     * Maximum number of attempts, including the first try.
     * Default: 3
     */
    maxAttempts?: number;
  
    /**
     * Base delay in milliseconds between attempts.
     * Default: 200 ms
     */
    baseDelayMs?: number;
  
    /**
     * Optional predicate to decide if an error is retryable.
     * If not provided, all errors are treated as retryable up to maxAttempts.
     */
    retryableError?: (error: unknown) => boolean;
  }
  
  /**
   * Execute an async operation with retry + simple linear backoff.
   *
   * Example:
   *   await withRetry(() => stripe.invoices.pay(id), {
   *     maxAttempts: 3,
   *     baseDelayMs: 250,
   *     retryableError: (err) => isStripeRateLimitError(err),
   *   });
   */
  export async function withRetry<T>(
    operation: () => Promise<T>,
    options: WithRetryOptions = {},
  ): Promise<T> {
    const {
      maxAttempts = 3,
      baseDelayMs = 200,
      retryableError,
    } = options;
  
    let lastError: unknown;
  
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
  
        // If a retryable predicate exists, and it says "don't retry", bail out immediately.
        if (retryableError && !retryableError(err)) {
          throw err;
        }
  
        // Last attempt: rethrow.
        if (attempt === maxAttempts) {
          throw err;
        }
  
        // Simple linear backoff: baseDelayMs * attempt
        const delayMs = baseDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  
    // Type safety fallback – in practice we always either return or throw above.
    throw lastError as Error;
  }