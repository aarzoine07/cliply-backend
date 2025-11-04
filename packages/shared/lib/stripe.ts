// packages/shared/lib/stripe.ts
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY missing in environment");
}

// create and export a Stripe instance
export const stripe = new Stripe(secretKey);
