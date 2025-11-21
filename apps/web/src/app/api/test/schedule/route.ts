// TEMP: Fake auth context for local backend testing only
const TEST_CONTEXT = {
    user_id: "00000000-0000-0000-0000-000000000101",
    workspace_id: "77777777-7777-7777-7777-777777777777",
    plan: "premium" as any,
  };
  
  import { NextResponse } from "next/server";
  import { withPlanGate } from "@/lib/withPlanGate";
  
  // -----------------------------------------------------------------------------
  // Fake wrapper that injects auth context BEFORE plan gating
  // -----------------------------------------------------------------------------
  function withFakeAuth(handler: any) {
    return async (req: any) => {
      // Inject BEFORE gating
      req.context = {
        user_id: TEST_CONTEXT.user_id,
        workspace_id: TEST_CONTEXT.workspace_id,
        plan: TEST_CONTEXT.plan,
      };
  
      return handler(req);
    };
  }
  
  // -----------------------------------------------------------------------------
  // Base handler
  // -----------------------------------------------------------------------------
  async function handler() {
    return NextResponse.json({ ok: true });
  }
  
  // -----------------------------------------------------------------------------
  // Export: fakeAuth → planGate → handler
  // -----------------------------------------------------------------------------
  export const GET = withFakeAuth(
    withPlanGate(async (req) => handler(), "schedule")
  );
  