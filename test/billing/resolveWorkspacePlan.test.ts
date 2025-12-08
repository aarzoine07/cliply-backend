import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveWorkspacePlan, type ResolvedPlan } from "@cliply/shared/billing/planResolution";

const WORKSPACE_ID = "123e4567-e89b-12d3-a456-426614174000";

function createMockSupabase() {
  const subscriptions: Array<{
    workspace_id: string;
    plan_name: string;
    status: string;
    current_period_end: string | null;
    stripe_subscription_id: string;
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
                      const filtered = subscriptions.filter(
                        (s) => s.workspace_id === value && values.includes(s.status),
                      );
                      const sorted = filtered.sort((a, b) => {
                        const aTime = a.current_period_end
                          ? new Date(a.current_period_end).getTime()
                          : 0;
                        const bTime = b.current_period_end
                          ? new Date(b.current_period_end).getTime()
                          : 0;
                        return options.ascending ? aTime - bTime : bTime - aTime;
                      });
                      return { data: sorted.length > 0 ? sorted[0] : null, error: null };
                    }),
                  })),
                })),
              })),
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

describe("resolveWorkspacePlan", () => {
  let supabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabase();
  });

  it("returns free plan when workspace has no subscription", async () => {
    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: supabase as any });

    expect(result.planId).toBe("basic");
    expect(result.status).toBe("free");
    expect(result.currentPeriodEnd).toBeNull();
    expect(result.stripeSubscriptionId).toBeNull();
  });

  it("returns active subscription plan when workspace has one active subscription", async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "pro",
      status: "active",
      current_period_end: periodEnd.toISOString(),
      stripe_subscription_id: "sub_test123",
    });

    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: supabase as any });

    expect(result.planId).toBe("pro");
    expect(result.status).toBe("active");
    expect(result.currentPeriodEnd).toEqual(periodEnd);
    expect(result.stripeSubscriptionId).toBe("sub_test123");
  });

  it("returns trialing subscription plan when workspace has trialing subscription", async () => {
    const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "premium",
      status: "trialing",
      current_period_end: periodEnd.toISOString(),
      stripe_subscription_id: "sub_trial123",
    });

    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: supabase as any });

    expect(result.planId).toBe("premium");
    expect(result.status).toBe("trialing");
    expect(result.currentPeriodEnd).toEqual(periodEnd);
  });

  it("returns active subscription when workspace has both canceled and active subscriptions", async () => {
    // Add canceled subscription (older)
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "basic",
      status: "canceled",
      current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      stripe_subscription_id: "sub_canceled123",
    });

    // Add active subscription (newer)
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "pro",
      status: "active",
      current_period_end: periodEnd.toISOString(),
      stripe_subscription_id: "sub_active123",
    });

    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: supabase as any });

    // Should return the active one, not the canceled one
    expect(result.planId).toBe("pro");
    expect(result.status).toBe("active");
    expect(result.stripeSubscriptionId).toBe("sub_active123");
  });

  it("returns subscription with latest current_period_end when multiple active subscriptions exist", async () => {
    // Add older active subscription
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "basic",
      status: "active",
      current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      stripe_subscription_id: "sub_old123",
    });

    // Add newer active subscription (later period end)
    const laterPeriodEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    supabase.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      plan_name: "premium",
      status: "active",
      current_period_end: laterPeriodEnd.toISOString(),
      stripe_subscription_id: "sub_new123",
    });

    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: supabase as any });

    // Should return the one with latest current_period_end
    expect(result.planId).toBe("premium");
    expect(result.currentPeriodEnd).toEqual(laterPeriodEnd);
    expect(result.stripeSubscriptionId).toBe("sub_new123");
  });

  it("handles database errors gracefully and returns default plan", async () => {
    // Mock supabase to return an error
    const errorSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: { message: "Database error" },
                  })),
                })),
              })),
            })),
          })),
        })),
      })),
    };

    const result = await resolveWorkspacePlan(WORKSPACE_ID, { supabase: errorSupabase as any });

    // Should return default plan on error
    expect(result.planId).toBe("basic");
    expect(result.status).toBe("free");
  });
});

