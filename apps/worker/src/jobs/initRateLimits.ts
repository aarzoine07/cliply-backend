import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { RATE_LIMIT_CONFIG } from "@cliply/shared/billing/rateLimitConfig";
import type { PlanName } from "@cliply/shared/types/auth";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type SubscriptionRow = {
  workspace_id: string;
  plan_name: PlanName | null;
};

/**
 * Seeds or refreshes rate-limit rows for all active workspaces.
 * Reads from subscriptions to ensure each (workspace_id, feature) bucket exists.
 */
export async function initRateLimitsJob(): Promise<void> {
  console.log("⚙️ Starting rate-limit initializer...");

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("workspace_id, plan_name")
    .eq("status", "active");

  if (error) {
    console.error("❌ Failed to fetch subscriptions:", error.message);
    return;
  }

  if (!subs || subs.length === 0) {
    console.log("ℹ️ No active subscriptions found; nothing to seed.");
    return;
  }

  const typedSubs = subs as SubscriptionRow[];

  for (const sub of typedSubs) {
    const { workspace_id, plan_name } = sub;
    const plan = (plan_name ?? "basic") as PlanName;
    const config = RATE_LIMIT_CONFIG[plan];

    if (!config) {
      console.warn(`⚠️ Unknown plan ${plan} for workspace ${workspace_id}; skipping.`);
      continue;
    }

    for (const feature of Object.keys(config) as Array<keyof typeof config>) {
      const { capacity, refill_rate } = config[feature];
      const nowIso = new Date().toISOString();

      const { error: upsertError } = await supabase
        .from("rate_limits")
        .upsert(
          {
            workspace_id,
            feature,
            capacity,
            refill_rate,
            tokens: capacity,
            last_refill_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: "workspace_id,feature" },
        );

      if (upsertError) {
        console.error(
          `❌ Failed to upsert rate-limit for workspace=${workspace_id} feature=${feature}:`,
          upsertError.message,
        );
        continue;
      }
    }

    console.log(`✅ Seeded rate-limits for workspace ${workspace_id} (${plan})`);
  }

  console.log("🎉 Rate-limit initializer complete.");
}

if (require.main === module) {
  initRateLimitsJob().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("💥 Rate-limit initializer failed:", message);
    process.exitCode = 1;
  });
}
