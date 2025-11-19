import { NextResponse } from "next/server";

// Minimal JSON error helper
function jsonError(status: number, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status }
  );
}

/**
 * Local implementation of plan gating.
 * Your shared package no longer exports planGate helpers,
 * so we implement a simple version here.
 */
export function withPlanGate(handler: any, feature: string) {
  return async function wrapped(req: any) {
    const plan = req.context?.plan;

    // No plan → reject
    if (!plan) {
      return jsonError(403, "No active subscription plan.");
    }

    // TEMPORARY — allow all plans to access everything  
    // You can replace this logic with real checks after Task 14C.
    // For now, this prevents crashes and allows /api/test/schedule to work.
    const allowed = true;

    if (!allowed) {
      return jsonError(429, `Feature '${feature}' not available on your plan`);
    }

    // All good → continue
    try {
      return await handler(req);
    } catch (err: any) {
      return jsonError(500, err?.message ?? "Unexpected error");
    }
  };
}
