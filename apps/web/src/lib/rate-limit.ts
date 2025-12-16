import { getAdminClient } from "./supabase";

export type RateLimitResult = { allowed: boolean; remaining: number };

export async function checkRateLimit(
  userId: string,
  route: string,
  capacity = 60,
  refillPerMin = 60,
): Promise<RateLimitResult> {
  // 🔒 Test-mode bypass: never hit Supabase in NODE_ENV==="test"
  if (process.env.NODE_ENV === "test") {
    return { allowed: true, remaining: capacity };
  }

  const admin = getAdminClient();

  try {
    const { data, error } = await admin.rpc("refill_tokens", {
      p_user_id: userId,
      p_route: route,
      p_capacity: capacity,
      p_refill_per_min: refillPerMin,
    });

    if (error) {
      // Fail open on rate-limit failure (don't break the whole request)
      return { allowed: true, remaining: capacity };
    }

    const remaining = typeof data === "number" ? data : capacity;
    return { allowed: remaining >= 0, remaining };
  } catch {
    // Any unexpected Supabase / network error → fail open
    return { allowed: true, remaining: capacity };
  }
}

