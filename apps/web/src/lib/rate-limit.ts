import { getAdminClient } from './supabase';

export type RateLimitResult = { allowed: boolean; remaining: number };

export async function checkRateLimit(
  userId: string,
  route: string,
  capacity = 60,
  refillPerMin = 60,
): Promise<RateLimitResult> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('refill_tokens', {
    p_user_id: userId,
    p_route: route,
    p_capacity: capacity,
    p_refill_per_min: refillPerMin,
  });

  if (error) {
    return { allowed: true, remaining: capacity };
  }

  const remaining = typeof data === 'number' ? data : capacity;
  return { allowed: remaining >= 0, remaining };
}
