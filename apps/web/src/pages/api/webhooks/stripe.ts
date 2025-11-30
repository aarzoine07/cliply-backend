import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BillingErrorCode, billingErrorResponse } from "@cliply/shared/types/billing";
import { logAuditEvent } from "@cliply/shared/logging/audit";
import {
  handleInvoiceEvent,
  handleSubscriptionEvent,
  upsertBillingFromCheckout,
} from "@/lib/billing/stripeHandlers";

import { serverEnv } from "@/lib/env";

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = serverEnv;

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

export const config = {
  api: {
    bodyParser: false,
  },
};

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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        try {
          await upsertBillingFromCheckout(session, supabase, stripe);
        } catch (err) {
          console.error("Error handling checkout.session.completed:", err);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        try {
          const workspaceId = await handleSubscriptionEvent(
            subscription,
            event.type,
            supabase,
            async (wsId: string, evtType: string, evtId: string, payload: Record<string, unknown>) => {
              // Map old signature to new logAuditEvent signature
              const action = evtType === "customer.subscription.created" 
                ? "subscription.created"
                : evtType === "customer.subscription.updated"
                ? "subscription.updated"
                : "subscription.deleted";
              
              try {
                await logAuditEvent({
                  workspaceId: wsId,
                  actorId: null,
                  eventType: "billing",
                  action,
                  targetId: subscription.id,
                  meta: {
                    stripe_event_id: evtId,
                    ...payload,
                  },
                });
              } catch (auditErr) {
                console.error("Error logging audit event:", auditErr);
              }
            },
          );
        } catch (err) {
          console.error(`Error handling ${event.type}:`, err);
        }
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        try {
          const workspaceId = await handleInvoiceEvent(invoice, event.type, supabase);
          if (workspaceId) {
            try {
              const action = event.type === "invoice.payment_succeeded"
                ? "invoice.payment_succeeded"
                : "invoice.payment_failed";
              
              await logAuditEvent({
                workspaceId,
                actorId: null,
                eventType: "billing",
                action,
                targetId: invoice.id,
                meta: {
                  stripe_event_id: event.id,
                  invoice_id: invoice.id,
                  subscription_id:
                    typeof invoice.subscription === "string"
                      ? invoice.subscription
                      : invoice.subscription?.id,
                  amount_paid: invoice.amount_paid,
                  amount_due: invoice.amount_due,
                  currency: invoice.currency,
                  status: invoice.status,
                },
              });
            } catch (auditErr) {
              console.error("Error logging audit event:", auditErr);
            }
          }
        } catch (err) {
          console.error(`Error handling ${event.type}:`, err);
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged but not processed.
        break;
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    // Catch-all: log but always return 200
    const message = err instanceof Error ? err.message : "Stripe webhook processing error.";
    console.error("Stripe webhook error:", message);
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
