import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

import {
  handleInvoiceEvent,
  handleSubscriptionEvent,
  upsertBillingFromCheckout,
} from "../../apps/web/src/lib/billing/stripeHandlers";
import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";

// Mock dependencies
vi.mock("@cliply/shared/billing/stripePlanMap", () => ({
  getPlanFromPriceId: vi.fn((priceId: string) => {
    const map: Record<string, string> = {
      price_basic: "basic",
      price_pro: "pro",
      price_premium: "premium",
    };
    return map[priceId] ?? null;
  }),
}));

vi.mock("../../apps/web/src/lib/billing/workspacePlanService", () => ({
  setWorkspacePlan: vi.fn(async () => {}),
}));

const WORKSPACE_ID = "123e4567-e89b-12d3-a456-426614174000";
const CUSTOMER_ID = "cus_test123";
const SUBSCRIPTION_ID = "sub_test123";
const PRICE_ID_BASIC = "price_basic";
const PRICE_ID_PRO = "price_pro";

function createMockSupabase() {
  const subscriptions: Array<{
    workspace_id: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    plan_name: string;
    price_id: string;
    status: string;
    current_period_end: string | null;
  }> = [];

  return {
    subscriptions,
    from: vi.fn((table: string) => {
      if (table === "subscriptions") {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn((column: string, value: unknown) => ({
              in: vi.fn((column: string, values: unknown[]) => ({
                order: vi.fn((column: string, options: { ascending: boolean }) => ({
                  limit: vi.fn((n: number) => ({
                    maybeSingle: vi.fn(async () => {
                      const sub = subscriptions.find(
                        (s) => s[column as keyof typeof subscriptions[0]] === value,
                      );
                      return { data: sub ?? null, error: null };
                    }),
                  })),
                })),
              })),
              maybeSingle: vi.fn(async () => {
                const sub = subscriptions.find(
                  (s) => s[column as keyof typeof subscriptions[0]] === value,
                );
                return { data: sub ?? null, error: null };
              }),
            })),
            upsert: vi.fn(async (data: unknown, options?: unknown) => {
              const subData = data as typeof subscriptions[0];
              const existingIndex = subscriptions.findIndex(
                (s) =>
                  s.workspace_id === subData.workspace_id &&
                  s.stripe_subscription_id === subData.stripe_subscription_id,
              );
              if (existingIndex >= 0) {
                subscriptions[existingIndex] = { ...subscriptions[existingIndex], ...subData };
              } else {
                subscriptions.push(subData);
              }
              return { error: null };
            }),
            update: vi.fn((data: unknown) => ({
              eq: vi.fn(async (column: string, value: unknown) => {
                const index = subscriptions.findIndex(
                  (s) => s[column as keyof typeof subscriptions[0]] === value,
                );
                if (index >= 0) {
                  subscriptions[index] = { ...subscriptions[index], ...(data as object) };
                }
                return { error: null };
              }),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn(async (column: string, value: unknown) => {
                const index = subscriptions.findIndex(
                  (s) => s[column as keyof typeof subscriptions[0]] === value,
                );
                if (index >= 0) {
                  subscriptions.splice(index, 1);
                }
                return { error: null };
              }),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ data: null, error: null })) })),
      };
    }),
  };
}

function createMockStripe() {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({
        id,
        customer: CUSTOMER_ID,
        status: "active",
        items: {
          data: [
            {
              price: {
                id: PRICE_ID_BASIC,
              },
            },
          ],
        },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        trial_end: null,
        created: Math.floor(Date.now() / 1000),
        latest_invoice: null,
        metadata: {
          workspace_id: WORKSPACE_ID,
        },
      })),
    },
  } as unknown as Stripe;
}

describe("Stripe webhook handlers", () => {
  let supabase: ReturnType<typeof createMockSupabase>;
  let stripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabase();
    stripe = createMockStripe();
  });

  describe("upsertBillingFromCheckout", () => {
    it("creates subscription record from checkout session with workspace_id in metadata", async () => {
      const session: Stripe.Checkout.Session = {
        id: "cs_test123",
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
        metadata: {
          workspace_id: WORKSPACE_ID,
        },
      } as Stripe.Checkout.Session;

      await upsertBillingFromCheckout(session, supabase as any, stripe);

      // Verify subscription was upserted
      expect(supabase.from).toHaveBeenCalledWith("subscriptions");
      expect(supabase.subscriptions.length).toBeGreaterThan(0);
      const sub = supabase.subscriptions[0];
      expect(sub.workspace_id).toBe(WORKSPACE_ID);
      expect(sub.stripe_customer_id).toBe(CUSTOMER_ID);
      expect(sub.stripe_subscription_id).toBe(SUBSCRIPTION_ID);
    });

    it("throws error if workspace_id is missing from metadata", async () => {
      const session: Stripe.Checkout.Session = {
        id: "cs_test123",
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
        metadata: {},
      } as Stripe.Checkout.Session;

      await expect(
        upsertBillingFromCheckout(session, supabase as any, stripe),
      ).rejects.toThrow("workspace_id");
    });
  });

  describe("handleSubscriptionEvent", () => {
    it("upserts subscription on created event", async () => {
      // Seed existing subscription for workspace resolution
      supabase.subscriptions.push({
        workspace_id: WORKSPACE_ID,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan_name: "basic",
        price_id: PRICE_ID_BASIC,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subscription: Stripe.Subscription = {
        id: SUBSCRIPTION_ID,
        customer: CUSTOMER_ID,
        status: "active",
        items: {
          data: [
            {
              price: {
                id: PRICE_ID_PRO,
              },
            },
          ],
        },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        trial_end: null,
        created: Math.floor(Date.now() / 1000),
        latest_invoice: null,
        metadata: {
          workspace_id: WORKSPACE_ID,
        },
      } as Stripe.Subscription;

      await handleSubscriptionEvent(subscription, "customer.subscription.created", supabase as any);

      // Verify subscription was updated with new plan
      const sub = supabase.subscriptions.find((s) => s.stripe_subscription_id === SUBSCRIPTION_ID);
      expect(sub).toBeDefined();
      expect(sub?.plan_name).toBe("pro");
    });

    it("updates plan_id when price changes (upgrade)", async () => {
      // Seed existing basic subscription
      supabase.subscriptions.push({
        workspace_id: WORKSPACE_ID,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan_name: "basic",
        price_id: PRICE_ID_BASIC,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subscription: Stripe.Subscription = {
        id: SUBSCRIPTION_ID,
        customer: CUSTOMER_ID,
        status: "active",
        items: {
          data: [
            {
              price: {
                id: PRICE_ID_PRO,
              },
            },
          ],
        },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        trial_end: null,
        created: Math.floor(Date.now() / 1000),
        latest_invoice: null,
        metadata: {
          workspace_id: WORKSPACE_ID,
        },
      } as Stripe.Subscription;

      await handleSubscriptionEvent(subscription, "customer.subscription.updated", supabase as any);

      const sub = supabase.subscriptions.find((s) => s.stripe_subscription_id === SUBSCRIPTION_ID);
      expect(sub?.plan_name).toBe("pro");
      expect(sub?.price_id).toBe(PRICE_ID_PRO);
    });

    it("deletes subscription record on deleted event", async () => {
      // Seed existing subscription
      supabase.subscriptions.push({
        workspace_id: WORKSPACE_ID,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan_name: "pro",
        price_id: PRICE_ID_PRO,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subscription: Stripe.Subscription = {
        id: SUBSCRIPTION_ID,
        customer: CUSTOMER_ID,
        status: "canceled",
        items: {
          data: [
            {
              price: {
                id: PRICE_ID_PRO,
              },
            },
          ],
        },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        trial_end: null,
        created: Math.floor(Date.now() / 1000),
        latest_invoice: null,
        metadata: {
          workspace_id: WORKSPACE_ID,
        },
      } as Stripe.Subscription;

      await handleSubscriptionEvent(subscription, "customer.subscription.deleted", supabase as any);

      // Verify subscription was deleted
      const sub = supabase.subscriptions.find((s) => s.stripe_subscription_id === SUBSCRIPTION_ID);
      expect(sub).toBeUndefined();
    });
  });

  describe("handleInvoiceEvent", () => {
    it("updates subscription status to past_due on payment_failed", async () => {
      // Seed existing subscription
      supabase.subscriptions.push({
        workspace_id: WORKSPACE_ID,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan_name: "pro",
        price_id: PRICE_ID_PRO,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const invoice: Stripe.Invoice = {
        id: "in_test123",
        subscription: SUBSCRIPTION_ID,
        amount_paid: 0,
        amount_due: 1000,
        currency: "usd",
        status: "open",
      } as Stripe.Invoice;

      const workspaceId = await handleInvoiceEvent(
        invoice,
        "invoice.payment_failed",
        supabase as any,
      );

      expect(workspaceId).toBe(WORKSPACE_ID);
      const sub = supabase.subscriptions.find((s) => s.stripe_subscription_id === SUBSCRIPTION_ID);
      expect(sub?.status).toBe("past_due");
    });

    it("updates subscription status to active on payment_succeeded", async () => {
      // Seed existing subscription with past_due status
      supabase.subscriptions.push({
        workspace_id: WORKSPACE_ID,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan_name: "pro",
        price_id: PRICE_ID_PRO,
        status: "past_due",
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const invoice: Stripe.Invoice = {
        id: "in_test123",
        subscription: SUBSCRIPTION_ID,
        amount_paid: 1000,
        amount_due: 0,
        currency: "usd",
        status: "paid",
      } as Stripe.Invoice;

      const workspaceId = await handleInvoiceEvent(
        invoice,
        "invoice.payment_succeeded",
        supabase as any,
      );

      expect(workspaceId).toBe(WORKSPACE_ID);
      const sub = supabase.subscriptions.find((s) => s.stripe_subscription_id === SUBSCRIPTION_ID);
      expect(sub?.status).toBe("active");
    });
  });
});

