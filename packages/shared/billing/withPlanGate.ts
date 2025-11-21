type NextApiRequest = any;
type NextApiResponse = any;
import { createClient } from "@supabase/supabase-js";
import { checkPlanAccess } from "./planGate";

/**
 * Wrap an API handler with plan gating.
 * This wrapper:
 *   1. Reads workspace_id (cookie or query)
 *   2. Fetches the current subscription
 *   3. Uses checkPlanAccess() to verify permissions
 */
export function withPlanGate(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<any>,
  feature: string
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const workspace_id =
      (req.query.workspaceId as string) || req.cookies["wsid"];

    if (!workspace_id) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "WORKSPACE_REQUIRED",
          message: "Workspace ID required",
        },
      });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Fetch subscription for workspace
    const { data: sub, error: subErr } = await supabase
      .from("subscriptions")
      .select("plan_name")
      .eq("workspace_id", workspace_id)
      .maybeSingle();

    if (subErr) {
      console.error("Failed to fetch subscription:", subErr);
      return res.status(500).json({
        ok: false,
        error: { code: "SUB_LOOKUP_FAILED", message: "Failed to lookup subscription" },
      });
    }

    const plan = sub?.plan_name ?? "free";
    const check = checkPlanAccess(plan as any, feature as any);

    if (!check.active) {
        const reason = (check as any).reason;
        const message = (check as any).message;
      
        return res.status(reason === "limit" ? 429 : 403).json({
          ok: false,
          error: {
            code: reason === "limit" ? "PLAN_LIMIT_EXCEEDED" : "PLAN_UPGRADE_REQUIRED",
            message,
          },
        });
      }

    // All good → pass to inner handler
    return handler(req, res);
  };
}