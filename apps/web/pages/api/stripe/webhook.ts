// FILE: apps/web/pages/api/stripe/webhook.ts
// FINAL VERSION – Stripe webhook using direct Stripe SDK

import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeSecretKey) {
  // In tests / dev this may be missing; in production you should set it.
  // We still construct a dummy instance so types compile.
  console.warn(
    "STRIPE_SECRET_KEY is not set. Stripe webhook handler will not work in production.",
  );
}

const stripe = new Stripe(stripeSecretKey ?? "sk_test_dummy", {
  apiVersion: "2024-06-20",
});

export const config = { api: { bodyParser: false } };

async function buffer(readable: Readable) {
  const chunks: Buffer[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of readable) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : chunk,
    );
  }
  return Buffer.concat(chunks);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || !webhookSecret) {
    console.error(
      "Stripe webhook missing signature or STRIPE_WEBHOOK_SECRET.",
    );
    return res
      .status(400)
      .send("Webhook Error: missing signature or secret");
  }

  const buf = await buffer(req);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig as string,
      webhookSecret,
    );
  } catch (err) {
    console.error(
      "⚠️  Webhook signature verification failed.",
      err,
    );
    const message =
      err instanceof Error ? err.message : "Unknown error";
    return res.status(400).send(`Webhook Error: ${message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      console.log(
        "✅ Checkout completed:",
        (event.data.object as Stripe.Checkout.Session).id,
      );
      break;
    case "customer.subscription.updated":
      console.log(
        "🔁 Subscription updated:",
        (event.data.object as Stripe.Subscription).id,
      );
      break;
    case "invoice.payment_failed":
      console.log(
        "💸 Payment failed:",
        (event.data.object as Stripe.Invoice).id,
      );
      break;
    default:
      console.log("Unhandled event type:", event.type);
  }

  res.status(200).json({ received: true });
}
