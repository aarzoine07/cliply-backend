async function upsertBillingCustomer(
  supabase: any,
  userId: string,
  stripeCustomerId: string
) {
  const { error } = await supabase
    .from("billing_customers")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
      },
      { onConflict: "stripe_customer_id" }
    );

  if (error) {
    console.error("❌ Billing customer upsert error:", error);
    throw new Error(error.message);
  }
}

import Stripe from "stripe";
import { stripePriceToPlan } from "@cliply/shared/billing/stripePlanMap";
import { getAdminClient } from "../supabase/admin";
import type { PlanName } from "../types/auth";

export async function handleCheckoutSessionCompleted(event: any, supabase: any) {
  const session = event.data.object as Stripe.Checkout.Session;

  // 1 — Extract metadata
  const userId = session.metadata?.user_id;
  const workspaceId = session.metadata?.workspace_id;
  const priceId = session.metadata?.price_id;

  if (!userId) throw new Error("Missing user_id in session metadata");
  if (!workspaceId) throw new Error("Missing workspace_id in session metadata");
  if (!priceId) throw new Error("Missing price_id in session metadata");

  // 2 — Determine plan from price
  const plan: PlanName = stripePriceToPlan(priceId);

  // 3 — Extract Stripe IDs
  const stripeCustomerId = session.customer as string;
  const stripeSubscriptionId = session.subscription as string;

  if (!stripeCustomerId) throw new Error("Missing Stripe customer ID");
  if (!stripeSubscriptionId) throw new Error("Missing Stripe subscription ID");

  // 4 — Always insert billing customer
  await upsertBillingCustomer(supabase, userId, stripeCustomerId);

  // 5 — Compute subscription period
  const currentPeriodStart = new Date().toISOString();
  const currentPeriodEnd = new Date(
    (session.expires_at ||
      Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30) * 1000
  ).toISOString();

  // 6 — Upsert subscription
  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        workspace_id: workspaceId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        plan_name: plan,
        price_id: priceId,
        status: "active",
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
      },
      { onConflict: "workspace_id" }
    );

  if (error) {
    console.error("❌ Subscription upsert error:", error);
    throw new Error(error.message);
  }

  return { ok: true, plan, workspaceId };
}