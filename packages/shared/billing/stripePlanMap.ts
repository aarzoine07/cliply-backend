import type { PlanName } from "../types/auth";

// Map Stripe Price IDs → internal plan names
const PRICE_TO_PLAN: Record<string, PlanName> = {
  // Replace these with your actual price IDs:
  [process.env.STRIPE_PRICE_BASIC!]: "basic",
  [process.env.STRIPE_PRICE_PRO!]: "pro",
  [process.env.STRIPE_PRICE_PREMIUM!]: "premium",
};

export function stripePriceToPlan(priceId: string): PlanName {
  const plan = PRICE_TO_PLAN[priceId];
  if (!plan) {
    throw new Error(`Unknown priceId: ${priceId}`);
  }
  return plan;
}