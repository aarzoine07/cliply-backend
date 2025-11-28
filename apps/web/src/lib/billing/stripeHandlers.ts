import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";
import type { BillingStatus } from "@cliply/shared/billing/status";
import type { PlanName } from "@cliply/shared/types/auth";
import { logStripeEvent } from "@cliply/shared/observability/logging";
import * as workspacePlanService from "./workspacePlanService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extracts workspace_id from Stripe metadata, supporting multiple key formats.
 */
function extractWorkspaceId(metadata: Stripe.Metadata | null | undefined): string | null {
  const candidate =
    metadata?.workspace_id ??
    metadata?.workspaceId ??
    metadata?.workspace ??
    metadata?.["workspace-id"];
  if (typeof candidate === "string" && UUID_PATTERN.test(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Maps Stripe subscription status to our internal status enum.
 */
function mapSubscriptionStatus(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incomplete_expired";
    case "paused":
      return "paused";
    default:
      return "incomplete";
  }
}

/**
 * Converts Unix timestamp to ISO string, or returns null if not provided.
 */
function toIso(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Resolves workspace_id from a Stripe subscription.
 */
async function resolveWorkspaceIdFromSubscription(
  sub: Stripe.Subscription,
  supabase: SupabaseClient,
): Promise<string> {
  const fromMetadata = extractWorkspaceId(sub.metadata);
  if (fromMetadata) return fromMetadata;

  const subscriptionId = sub.id;
  const { data: subscriptionRow, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("workspace_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (subscriptionError) {
    throw new Error(
      `Failed to resolve workspace for subscription ${subscriptionId}: ${subscriptionError.message}`,
    );
  }
  if (subscriptionRow?.workspace_id) return subscriptionRow.workspace_id;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (customerId) {
    const { data: customerRow, error: customerError } = await supabase
      .from("subscriptions")
      .select("workspace_id")
      .eq("stripe_customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (customerError) {
      throw new Error(
        `Failed to resolve workspace via customer ${customerId}: ${customerError.message}`,
      );
    }
    if (customerRow?.workspace_id) return customerRow.workspace_id;
  }

  throw new Error(`Workspace ID not found for subscription ${subscriptionId}`);
}

/**
 * Handles checkout.session.completed.
 */
export async function upsertBillingFromCheckout(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient,
  stripe: Stripe,
): Promise<void> {
  const workspaceId = extractWorkspaceId(session.metadata);
  if (!workspaceId) {
    const error = new Error(
      `Checkout session ${session.id} missing workspace_id in metadata.`,
    );
    logStripeEvent("checkout.session.completed", {
      workspaceId: undefined,
      stripeEventId: session.id,
      error,
    });
    throw error;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    const error = new Error(`Checkout session ${session.id} missing customer ID`);
    logStripeEvent("checkout.session.completed", {
      workspaceId,
      stripeEventId: session.id,
      error,
    });
    throw error;
  }

  logStripeEvent("checkout.session.completed", {
    workspaceId,
    stripeCustomerId: customerId,
    stripeEventId: session.id,
  });

  try {
    if (session.subscription && typeof session.subscription === "string") {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertSubscriptionRecord(subscription, workspaceId, supabase, "checkout.session.completed");
    } else {
      console.warn(`Checkout session ${session.id} completed but no subscription ID present`);
    }
  } catch (error) {
    logStripeEvent("checkout.session.completed", {
      workspaceId,
      stripeCustomerId: customerId,
      stripeEventId: session.id,
      error,
    });
    throw error;
  }
}

/**
 * Closes the current open usage period.
 */
async function closeCurrentUsagePeriod(
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("workspace_usage")
      .update({ period_end: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .is("period_end", null);

    if (error) {
      console.error(`Failed to close usage period for workspace ${workspaceId}:`, error.message);
    }
  } catch (error) {
    console.error(`Error closing usage period for workspace ${workspaceId}:`, error);
  }
}

/**
 * Opens a new usage period.
 */
async function openNewUsagePeriod(
  workspaceId: string,
  periodStart: Date,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const periodStartIso = periodStart.toISOString();

    const { data: existing } = await supabase
      .from("workspace_usage")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("period_start", periodStartIso)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("workspace_usage").insert({
        workspace_id: workspaceId,
        period_start: periodStartIso,
        period_end: null,
        clips_count: 0,
        source_minutes: 0,
        projects_count: 0,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error(`Failed to open usage period for workspace ${workspaceId}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`Error opening usage period for workspace ${workspaceId}:`, error);
  }
}

/**
 * Handles subscription created/updated/deleted.
 */
export async function handleSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventType: string,
  supabase: SupabaseClient,
  logAudit?: (workspaceId: string, eventType: string, eventId: string, payload: Record<string, unknown>) => Promise<void>,
): Promise<string | null> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

  logStripeEvent(eventType, {
    stripeCustomerId: customerId ?? undefined,
    stripeSubscriptionId: subscription.id,
    stripeEventId: subscription.id,
  });

  let workspaceId: string | null = null;
  try {
    workspaceId = await resolveWorkspaceIdFromSubscription(subscription, supabase);

    if (eventType === "customer.subscription.deleted") {
      if (workspaceId) {
        await closeCurrentUsagePeriod(workspaceId, supabase);
      }
      await deleteSubscriptionRecord(subscription, workspaceId!, supabase);

      if (logAudit && workspaceId) {
        try {
          await logAudit(workspaceId, eventType, subscription.id, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId ?? null,
          });
        } catch (auditError) {
          console.error("Failed to log audit event:", auditError);
        }
      }
    } else {
      const status = mapSubscriptionStatus(subscription.status);
      await upsertSubscriptionRecord(subscription, workspaceId!, supabase, eventType);

      if (workspaceId) {
        const periodStart = subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000)
          : new Date();
        const periodStartMonth = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));

        await openNewUsagePeriod(workspaceId, periodStartMonth, supabase);
      }

      if (logAudit && workspaceId) {
        try {
          const price = subscription.items.data[0]?.price;
          const plan = (getPlanFromPriceId(price?.id ?? "") ?? "basic") as PlanName;
          await logAudit(workspaceId, eventType, subscription.id, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId ?? null,
            plan,
            status,
            latest_invoice: subscription.latest_invoice ?? null,
          });
        } catch (auditError) {
          console.error("Failed to log audit event:", auditError);
        }
      }
    }

    logStripeEvent(eventType, {
      workspaceId: workspaceId ?? undefined,
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      stripeEventId: subscription.id,
    });

    return workspaceId;
  } catch (error) {
    logStripeEvent(eventType, {
      workspaceId: workspaceId ?? undefined,
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      stripeEventId: subscription.id,
      error,
    });

    console.error(`Error handling subscription event ${eventType}:`, error);
    return null;
  }
}

/**
 * Upserts a subscription record.
 */
async function upsertSubscriptionRecord(
  sub: Stripe.Subscription,
  workspaceId: string,
  supabase: SupabaseClient,
  eventType: string,
): Promise<void> {
  const price = sub.items.data[0]?.price;
  if (!price?.id) {
    console.error(`Subscription ${sub.id} does not contain a valid price item`);
    return;
  }

  const plan = (getPlanFromPriceId(price.id) ?? "basic") as PlanName;
  const status = mapSubscriptionStatus(sub.status);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const { error } = await supabase.from("subscriptions").upsert(
    {
      workspace_id: workspaceId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      plan_name: plan,
      price_id: price.id,
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
    console.error(`Failed to upsert subscription ${sub.id}:`, error.message);
    return;
  }

  try {
    await workspacePlanService.setWorkspacePlan(workspaceId, plan, { supabase }, {
      billingStatus: status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
    });
  } catch (error) {
    console.error(`Failed to update workspace plan for ${workspaceId}:`, error);
  }
}

/**
 * Deletes a subscription record.
 */
async function deleteSubscriptionRecord(
  sub: Stripe.Subscription,
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("stripe_subscription_id", sub.id);

  if (error) {
    console.error(`Failed to delete subscription ${sub.id}:`, error.message);
    return;
  }

  try {
    await workspacePlanService.setWorkspacePlan(
      workspaceId,
      "basic",
      { supabase },
      {
        billingStatus: "canceled",
        stripeCustomerId: undefined,
        stripeSubscriptionId: undefined,
      },
    );
  } catch (error) {
    console.error(`Failed to reset workspace plan for ${workspaceId}:`, error);
  }
}

/**
 * Handles invoices.
 */
export async function handleInvoiceEvent(
  invoice: Stripe.Invoice,
  eventType: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) {
    console.error(`Invoice ${invoice.id} does not include a subscription reference`);
    return null;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("workspace_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to resolve workspace for invoice ${invoice.id}:`, error.message);
    return null;
  }
  if (!data?.workspace_id) {
    console.error(`Workspace ID not found for invoice ${invoice.id}`);
    return null;
  }

  const workspaceId = data.workspace_id;

  if (eventType === "invoice.payment_failed") {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "past_due",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (updateError) {
      console.error(
        `Failed to update subscription status for invoice ${invoice.id}:`,
        updateError.message,
      );
      return workspaceId;
    }
  } else if (eventType === "invoice.payment_succeeded") {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (updateError) {
      console.error(
        `Failed to update subscription status for invoice ${invoice.id}:`,
        updateError.message,
      );
      return workspaceId;
    }
  }

  return workspaceId;
}

