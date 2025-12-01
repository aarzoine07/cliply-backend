import { createCircuitBreaker, type CircuitBreaker } from "./externalServiceResilience";

/**
 * YouTube circuit breaker instance
 * Shared across all YouTube operations in the worker process
 */
export const youtubeCircuitBreaker: CircuitBreaker = createCircuitBreaker("youtube", {
  failureThreshold: 5,
  cooldownMs: 30000, // 30 seconds
  halfOpenMaxAttempts: 1,
});

/**
 * TikTok circuit breaker instance
 * Shared across all TikTok operations in the worker process
 */
export const tiktokCircuitBreaker: CircuitBreaker = createCircuitBreaker("tiktok", {
  failureThreshold: 5,
  cooldownMs: 30000, // 30 seconds
  halfOpenMaxAttempts: 1,
});

/**
 * Stripe circuit breaker instance (optional, conservative)
 * Only opens on repeated 5xx/connection failures
 */
export const stripeCircuitBreaker: CircuitBreaker = createCircuitBreaker("stripe", {
  failureThreshold: 10, // Higher threshold for Stripe (more conservative)
  cooldownMs: 60000, // 60 seconds
  halfOpenMaxAttempts: 2,
});

