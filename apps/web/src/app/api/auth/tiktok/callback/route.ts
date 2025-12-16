// FILE: apps/web/src/app/api/auth/tiktok/callback/route.ts
// DEPRECATED – use /api/auth/tiktok/connect/callback instead.

/**
 * This route used to handle TikTok OAuth callbacks.
 * The canonical route is now:
 *
 *   /api/auth/tiktok/connect/callback
 *
 * To avoid build-time module resolution issues and keep behavior explicit,
 * this endpoint simply returns a 410 Gone with a clear error payload.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "TIKTOK_ROUTE_DEPRECATED",
        message:
          "This route has been replaced. Use /api/auth/tiktok/connect/callback instead.",
      },
    },
    { status: 410 },
  );
}
