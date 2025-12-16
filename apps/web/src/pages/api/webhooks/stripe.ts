import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  handleInvoiceEvent,
  handleSubscriptionEvent,
  upsertBillingFromCheckout,
} from "@/lib/billing/stripeHandlers";
import { serverEnv } from "@/lib/env";

async function buffer(readable: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: { message: "method_not_allowed" } });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).json({
      ok: false,
      error: { message: "missing_stripe_signature" },
    });
  }

  const {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  } = serverEnv;

  // IMPORTANT: no top-level throws — validate inside the handler
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: { message: "server_misconfigured" },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let event: Stripe.Event;
  try {
    const raw = await buffer(req as unknown as Readable);
    event = stripe.webhooks.constructEvent(raw, signature as string, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_stripe_signature";
    return res.status(400).json({
      ok: false,
      error: { message },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await upsertBillingFromCheckout(session, supabase, stripe);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionEvent(subscription, event.type, supabase);
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceEvent(invoice, event.type, supabase);
        break;
      }

      default:
        // acknowledge unhandled event types
        break;
    }
  } catch (err) {
    // Acknowledge receipt even if processing fails to avoid Stripe retries storms.
    // Logging can happen inside stripeHandlers.
    console.error("stripe_webhook_processing_error", err);
  }

  return res.status(200).json({ received: true });
}