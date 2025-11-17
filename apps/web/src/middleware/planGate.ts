import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const LIMITS: Record<string, number> = {
  basic: 5,
  pro: 20,
  premium: Number.POSITIVE_INFINITY,
};

async function getPlanAndUsage(workspace_id: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase configuration missing");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_name, status")
    .eq("workspace_id", workspace_id)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const plan = (sub?.plan_name || "basic").toLowerCase();
  const active = sub?.status && ["active", "trialing"].includes(sub.status);
  const effPlan = active ? plan : "basic";

  // Count today's schedules
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { count, error: cErr } = await supabase
    .from("schedules")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace_id)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());

  if (cErr) {
    console.error("Failed to count schedules:", cErr);
    return { plan: effPlan, used: 0 };
  }

  const used = count ?? 0;
  return { plan: effPlan, used };
}

export function withPlanGate(handler: NextApiHandler, action: "publish" | "schedule"): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const workspace_id = req.cookies["wsid"];

    if (!workspace_id) {
      return res.status(400).json({
        ok: false,
        error: { code: "WORKSPACE_REQUIRED", message: "Workspace ID required" },
      });
    }

    // Only gate schedule/publish
    if (action === "schedule") {
      try {
        const { plan, used } = await getPlanAndUsage(workspace_id);
        const limit = LIMITS[plan] ?? LIMITS["basic"];

        if (used >= limit) {
          return res.status(429).json({
            ok: false,
            error: {
              code: "PLAN_LIMIT_EXCEEDED",
              message: `Daily schedule limit reached for plan '${plan}'`,
            },
          });
        }
      } catch (error) {
        console.error("Plan gate error:", error);
        return res.status(500).json({
          ok: false,
          error: { code: "PLAN_GATE_ERROR", message: "Failed to check plan limits" },
        });
      }
    }

    return handler(req, res);
  };
}

