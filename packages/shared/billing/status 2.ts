/**
 * Billing subscription status types matching Stripe webhook values.
 * Used consistently across webhook handlers and subscription management.
 */
export type BillingStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

