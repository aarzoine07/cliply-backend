import { getEnv } from "@cliply/shared/env";
import { NextResponse } from "next/server";

import { getAdminClient, getRlsClient } from "@/lib/supabase";

export async function GET() {
  const env = getEnv();
  const hasRls = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && getRlsClient());
  const hasAdmin = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && getAdminClient());

  return NextResponse.json({
    ok: true,
    db: hasAdmin || hasRls ? "configured" : "missing_env",
    storage: "unknown",
  });
}
