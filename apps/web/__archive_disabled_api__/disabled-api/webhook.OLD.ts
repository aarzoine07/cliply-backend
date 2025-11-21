import { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import { stripe } from "@cliply/shared/lib/stripe";

export const config = { api: { bodyParser: false } };

async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("⚠️  Webhook signature verification failed.", err);
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      console.log("✅ Checkout completed:", event.data.object.id);
      break;
    case "customer.subscription.updated":
      console.log("🔁 Subscription updated:", event.data.object.id);
      break;
    case "invoice.payment_failed":
      console.log("💸 Payment failed:", event.data.object.id);
      break;
    default:
      console.log("Unhandled event type:", event.type);
  }

  res.status(200).json({ received: true });
}

