import { buffer } from "micro";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

import { handleCheckoutSessionCompleted } from "@cliply/shared/billing/stripeWebhook";

export const config = {
  api: {
    bodyParser: false, // Required for Stripe signature verification
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing Stripe signature");
  }

  let buf: Buffer;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error("❌ Failed to read request buffer:", err);
    return res.status(400).send("Invalid body");
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`✔️ Webhook received: ${event.type}`);

  // Create Supabase admin client
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
  );

  switch (event.type) {
    case "checkout.session.completed":
      try {
        await handleCheckoutSessionCompleted(event, supabase);
        console.log("➡️ checkout.session.completed processed");
      } catch (e) {
        console.error("❌ Failed to process session completed:", e);
      }
      break;

    default:
      console.log(`↪️ Unhandled event type: ${event.type}`);
  }

  return res.status(200).send("OK");
}
