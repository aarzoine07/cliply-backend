import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { handleCheckoutSessionCompleted } from "@cliply/shared/billing/stripeWebhook";

/**
 * Next.js must NOT parse the body. Stripe requires the raw stream.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

// --- Raw body reader (replacement for `micro` buffer()) ---
async function rawBuffer(req: NextApiRequest): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Verify signature header
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing Stripe signature");
  }

  // Read raw body
  let buf: Buffer;
  try {
    buf = await rawBuffer(req);
  } catch (err) {
    console.error("❌ Failed to read request buffer:", err);
    return res.status(400).send("Invalid body");
  }

  // Verify Stripe signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Stripe signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`✔️ Webhook received: ${event.type}`);

  // Supabase admin client
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // --- EVENT ROUTING ---
  switch (event.type) {
    case "checkout.session.completed":
      try {
        await handleCheckoutSessionCompleted(event, supabase);
        console.log("➡️ checkout.session.completed processed");
      } catch (err) {
        console.error("❌ Failed to process session completed:", err);
      }
      break;

    default:
      console.log(`↪️ Unhandled event type: ${event.type}`);
  }

  return res.status(200).send("OK");
}

