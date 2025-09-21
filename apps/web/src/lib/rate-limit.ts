export type RateLimitResult = { allowed: boolean };
export function rateLimitStub(): RateLimitResult {
  return { allowed: true };
}
