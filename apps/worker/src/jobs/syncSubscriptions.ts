import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";
import type { PlanName } from "@cliply/shared/types/auth";
import { env } from "../env";

const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}
if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type SupportedSubscriptionStatus = "active" | "trialing" | "canceled" | "incomplete" | "past_due";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapSubscriptionStatus(status: Stripe.Subscription.Status): SupportedSubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "canceled":
      return "canceled";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "incomplete";
    default:
      return "incomplete";
  }
}

function toIso(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

async function logAuditEvent(
  workspaceId: string,
  subscriptionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("events_audit").insert({
    workspace_id: workspaceId,
    actor_id: null,
    event_type: "stripe_sync",
    target_id: subscriptionId,
    payload,
  });

  if (error) {
    console.error("⚠️ Failed to log audit event:", error.message);
  }
}

async function upsertSubscription(
  workspaceId: string,
  sub: Stripe.Subscription,
  plan: PlanName,
): Promise<void> {
  const status = mapSubscriptionStatus(sub.status);
  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        workspace_id: workspaceId,
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
        stripe_subscription_id: sub.id,
        plan_name: plan,
        price_id: sub.items.data[0]?.price.id ?? null,
        status,
        current_period_start: toIso(sub.current_period_start),
        current_period_end: toIso(sub.current_period_end),
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        trial_end: toIso(sub.trial_end),
        created_at: toIso(sub.created),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,stripe_subscription_id" },
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncSubscriptionsJob(): Promise<void> {
  console.log("🧾 Starting subscription sync job...");

  try {
    // 1. Paginate through all subscriptions (Stripe supports pagination via starting_after).
    let startingAfter: string | undefined;
    let processed = 0;

    do {
      const stripeSubs = await stripe.subscriptions.list({
        status: "all",
        limit: 100,
        starting_after: startingAfter,
      });

      for (const sub of stripeSubs.data) {
        processed += 1;

        const price = sub.items.data[0]?.price;
        const plan = (price?.id ? getPlanFromPriceId(price.id) : null) ?? "basic";

        const workspaceId =
          typeof sub.metadata?.workspace_id === "string" && UUID_PATTERN.test(sub.metadata.workspace_id)
            ? sub.metadata.workspace_id
            : null;

        if (!workspaceId) {
          console.warn(`⚠️ Subscription ${sub.id} missing valid workspace_id metadata`);
          continue;
        }

        try {
          // 2. Upsert subscription record in Supabase to keep parity.
          await upsertSubscription(workspaceId, sub, plan);

          // 3. Log compliance event detailing the sync action (idempotent).
          await logAuditEvent(workspaceId, sub.id, {
            stripe_subscription_id: sub.id,
            stripe_customer_id:
              typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
            plan,
            status: sub.status,
            synced_at: new Date().toISOString(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to sync subscription ${sub.id}:`, message);
        }
      }

      startingAfter = stripeSubs.data.length > 0 ? stripeSubs.data[stripeSubs.data.length - 1].id : undefined;
      if (!stripeSubs.has_more) {
        startingAfter = undefined;
      }
    } while (startingAfter);

    console.log(`✅ Sync complete: ${processed} subscriptions processed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("💥 Subscription sync failed:", message);
  }
}

if (require.main === module) {
  syncSubscriptionsJob().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("💥 Subscription sync terminated with error:", message);
    process.exitCode = 1;
  });
}
