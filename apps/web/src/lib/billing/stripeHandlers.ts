// FILE: apps/web/src/lib/billing/stripeHandlers.ts
// FINAL VERSION – Stripe webhook helpers for subscriptions/invoices

import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";
import type { PlanName } from "@cliply/shared/types/auth";
import { logStripeEvent } from "@cliply/shared/observability/logging";
import * as workspacePlanService from "./workspacePlanService";
import { withRetry } from "@cliply/shared/resilience/externalServiceResilience";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Determine if a Stripe API call error should be retried
 * Only retry on network errors and clearly transient Stripe errors (5xx)
 * Do NOT retry on validation errors or auth errors
 */
function shouldRetryStripeCall(error: unknown): boolean {
  // Network errors and timeouts
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.includes("timeout")) {
      return true;
    }
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ENOTFOUND")
    ) {
      return true;
    }
  }

  // Stripe errors
  if (error && typeof error === "object" && "type" in error) {
    const stripeError = error as { type?: string; statusCode?: number };

    // Retry on 5xx server errors
    if (stripeError.statusCode && stripeError.statusCode >= 500) {
      return true;
    }

    // Do NOT retry on:
    // - card_declined
    // - invalid_request_error
    // - authentication_error
    if (stripeError.type) {
      const nonRetryableTypes = [
        "card_error",
        "invalid_request_error",
        "authentication_error",
      ];
      if (nonRetryableTypes.includes(stripeError.type)) {
        return false;
      }
    }
  }

  // Default: don't retry unknown errors
  return false;
}

type SupportedSubscriptionStatus =
  | "active"
  | "trialing"
  | "canceled"
  | "incomplete"
  | "past_due";

/**
 * Extracts workspace_id from Stripe metadata, supporting multiple key formats.
 */
function extractWorkspaceId(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
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
function mapSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SupportedSubscriptionStatus {
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

/**
 * Converts Unix timestamp to ISO string, or returns null if not provided.
 */
function toIso(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Resolves workspace_id from a Stripe subscription.
 * Tries metadata first, then existing subscription record, then customer lookup.
 */
async function resolveWorkspaceIdFromSubscription(
  sub: Stripe.Subscription,
  supabase: SupabaseClient,
): Promise<string> {
  // First, try metadata
  const fromMetadata = extractWorkspaceId(sub.metadata);
  if (fromMetadata) return fromMetadata;

  // Second, try existing subscription record
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

  // Third, try customer lookup via subscriptions table
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
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
 * Handles checkout.session.completed event.
 * Creates/updates subscription record and links it to workspace.
 */
export async function upsertBillingFromCheckout(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient,
  stripe: Stripe,
): Promise<void> {
  const workspaceId = extractWorkspaceId(session.metadata);
  if (!workspaceId) {
    const error = new Error(
      `Checkout session ${session.id} missing workspace_id in metadata. Cannot link subscription.`,
    );
    logStripeEvent("checkout.session.completed", {
      workspaceId: undefined,
      stripeEventId: session.id,
      error,
    });
    throw error;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
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
      const subscription = await withRetry(
        async () => {
          return await stripe.subscriptions.retrieve(
            session.subscription as string,
          );
        },
        {
          maxAttempts: 2,
          baseDelayMs: 300,
          retryableError: (error) => shouldRetryStripeCall(error),
        },
      );

      await upsertSubscriptionRecord(
        subscription,
        workspaceId,
        supabase,
        "checkout.session.completed",
      );
    } else {
      console.warn(
        `Checkout session ${session.id} completed but no subscription ID present`,
      );
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
 * Handles customer.subscription.created, updated, and deleted events.
 */
export async function handleSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventType: string,
  supabase: SupabaseClient,
  logAudit?: (
    workspaceId: string,
    eventType: string,
    eventId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>,
): Promise<string> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  logStripeEvent(eventType, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeEventId: subscription.id,
  });

  let workspaceId: string;
  try {
    workspaceId = await resolveWorkspaceIdFromSubscription(
      subscription,
      supabase,
    );

    if (eventType === "customer.subscription.deleted") {
      await deleteSubscriptionRecord(subscription, workspaceId, supabase);
      if (logAudit) {
        await logAudit(workspaceId, eventType, subscription.id, {
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId ?? null,
        });
      }
    } else {
      await upsertSubscriptionRecord(
        subscription,
        workspaceId,
        supabase,
        eventType,
      );
      if (logAudit) {
        const price = subscription.items.data[0]?.price;
        const plan = (getPlanFromPriceId(price?.id ?? "") ??
          "basic") as PlanName;
        const status = mapSubscriptionStatus(subscription.status);
        await logAudit(workspaceId, eventType, subscription.id, {
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId ?? null,
          plan,
          status,
          latest_invoice: subscription.latest_invoice ?? null,
        });
      }
    }

    logStripeEvent(eventType, {
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripeEventId: subscription.id,
    });

    return workspaceId;
  } catch (error) {
    logStripeEvent(eventType, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripeEventId: subscription.id,
      error,
    });
    throw error;
  }
}

/**
 * Upserts a subscription record in the database.
 */
async function upsertSubscriptionRecord(
  sub: Stripe.Subscription,
  workspaceId: string,
  supabase: SupabaseClient,
  eventType: string,
): Promise<void> {
  const price = sub.items.data[0]?.price;
  if (!price?.id) {
    throw new Error(`Subscription ${sub.id} does not contain a valid price item`);
  }

  const plan = (getPlanFromPriceId(price.id) ?? "basic") as PlanName;
  const status = mapSubscriptionStatus(sub.status);
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

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
    throw new Error(`Failed to upsert subscription ${sub.id}: ${error.message}`);
  }

  try {
    await workspacePlanService.setWorkspacePlan(
      workspaceId,
      plan,
      { supabase },
      {
        billingStatus: status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
      },
    );
  } catch (error) {
    console.error(
      `Failed to update workspace plan for ${workspaceId}:`,
      error,
    );
  }
}

/**
 * Deletes a subscription record when subscription is canceled.
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
    throw new Error(`Failed to delete subscription ${sub.id}: ${error.message}`);
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
    console.error(
      `Failed to reset workspace plan for ${workspaceId}:`,
      error,
    );
  }
}

/**
 * Handles invoice events (payment_succeeded, payment_failed).
 */
export async function handleInvoiceEvent(
  invoice: Stripe.Invoice,
  eventType: string,
  supabase: SupabaseClient,
): Promise<string> {
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subscriptionId) {
    throw new Error(
      `Invoice ${invoice.id} does not include a subscription reference`,
    );
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("workspace_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve workspace for invoice ${invoice.id}: ${error.message}`,
    );
  }
  if (!data?.workspace_id) {
    throw new Error(`Workspace ID not found for invoice ${invoice.id}`);
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
      throw new Error(
        `Failed to update subscription status for invoice ${invoice.id}: ${updateError.message}`,
      );
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
      throw new Error(
        `Failed to update subscription status for invoice ${invoice.id}: ${updateError.message}`,
      );
    }
  }

  return workspaceId;
}
