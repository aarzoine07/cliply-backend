import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";
import type { PlanName } from "@cliply/shared/types/auth";
import { BillingErrorCode, billingErrorResponse } from "@cliply/shared/types/billing";

type SupportedSubscriptionStatus = "active" | "trialing" | "canceled" | "incomplete" | "past_due";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}
if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
}
if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const endpointSecret = STRIPE_WEBHOOK_SECRET;
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const config = {
  api: {
    bodyParser: false,
  },
};

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

async function resolveWorkspaceIdFromSubscription(sub: Stripe.Subscription): Promise<string> {
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

async function resolveWorkspaceIdFromInvoice(invoice: Stripe.Invoice): Promise<string> {
  const fromMetadata = extractWorkspaceId(invoice.metadata);
  if (fromMetadata) return fromMetadata;

  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) {
    throw new Error(`Invoice ${invoice.id} does not include a subscription reference`);
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
  return data.workspace_id;
}

async function logAuditEvent(
  workspaceId: string,
  eventType: string,
  stripeEventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("events_audit").insert({
    workspace_id: workspaceId,
    actor_id: null,
    event_type: eventType,
    target_id: workspaceId,
    payload: { stripe_event_id: stripeEventId, ...payload },
  });

  if (error) {
    throw new Error(`Failed to record audit event (${eventType}): ${error.message}`);
  }
}

async function upsertSubscriptionRecord(
  sub: Stripe.Subscription,
  eventType: string,
  eventId: string,
): Promise<void> {
  const price = sub.items.data[0]?.price;
  if (!price?.id) {
    throw new Error(`Subscription ${sub.id} does not contain a valid price item`);
  }

  const workspaceId = await resolveWorkspaceIdFromSubscription(sub);
  const plan = (getPlanFromPriceId(price.id) ?? "basic") as PlanName;
  const status = mapSubscriptionStatus(sub.status);

  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        workspace_id: workspaceId,
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
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

  await logAuditEvent(workspaceId, eventType, eventId, {
    stripe_subscription_id: sub.id,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    plan,
    status,
    latest_invoice: sub.latest_invoice ?? null,
  });
}

async function deleteSubscriptionRecord(
  sub: Stripe.Subscription,
  eventType: string,
  eventId: string,
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdFromSubscription(sub);
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("stripe_subscription_id", sub.id);

  if (error) {
    throw new Error(`Failed to delete subscription ${sub.id}: ${error.message}`);
  }

  await logAuditEvent(workspaceId, eventType, eventId, {
    stripe_subscription_id: sub.id,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
  });
}

async function handleInvoiceEvent(
  invoice: Stripe.Invoice,
  eventType: string,
  eventId: string,
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdFromInvoice(invoice);

  if (eventType === "invoice.payment_failed" && typeof invoice.subscription === "string") {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "past_due",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", invoice.subscription);

    if (error) {
      throw new Error(
        `Failed to update subscription status for invoice ${invoice.id}: ${error.message}`,
      );
    }
  }

  if (eventType === "invoice.payment_succeeded" && typeof invoice.subscription === "string") {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", invoice.subscription);

    if (error) {
      throw new Error(
        `Failed to update subscription status for invoice ${invoice.id}: ${error.message}`,
      );
    }
  }

  await logAuditEvent(workspaceId, eventType, eventId, {
    invoice_id: invoice.id,
    subscription_id:
      typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id,
    amount_paid: invoice.amount_paid,
    amount_due: invoice.amount_due,
    currency: invoice.currency,
    status: invoice.status,
  });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      billingErrorResponse(
        BillingErrorCode.INVALID_SIGNATURE,
        "Missing Stripe signature header.",
        400,
      ),
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid Stripe signature.";
    return NextResponse.json(
      billingErrorResponse(BillingErrorCode.INVALID_SIGNATURE, message, 400),
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertSubscriptionRecord(subscription, event.type, event.id);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await deleteSubscriptionRecord(subscription, event.type, event.id);
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceEvent(invoice, event.type, event.id);
        break;
      }
      default:
        // Unhandled event types are acknowledged but not processed.
        break;
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe webhook processing error.";
    console.error("Stripe webhook error:", message);
    return NextResponse.json(
      billingErrorResponse(BillingErrorCode.WEBHOOK_ERROR, message, 500),
      { status: 500 },
    );
  }
}
