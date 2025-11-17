import { NextRequest } from "next/server";
import Stripe from "stripe";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function bufferToString(buffer: Uint8Array): string {
  // Convert Body to string for signature verification
  return Buffer.from(buffer).toString("utf-8");
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await req.arrayBuffer().then((buf) => new Uint8Array(buf));
  } catch (err) {
    return new Response("Failed to read raw body", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      bufferToString(rawBody),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`✔️ Webhook received: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      // You can add DB upsert logic here if not already in shared package
      console.log("➡️ checkout.session.completed handled");
      break;
    }
    default: {
      console.log(`↪️ Unhandled event type: ${event.type}`);
    }
  }

  return new Response("OK", { status: 200 });
}