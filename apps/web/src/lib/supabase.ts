import { getEnv } from "../../../../packages/shared/env";
import { logJSON } from "../../../../packages/shared/logger";

import { Client } from "pg";

export async function pgCheck(): Promise<{ ok: boolean; db?: string; error?: string }> {
  const { DATABASE_URL } = getEnv();

  const url = DATABASE_URL.includes("sslmode=")
    ? DATABASE_URL
    : `${DATABASE_URL}${DATABASE_URL.includes("?") ? "&" : "?"}sslmode=require`;

  const prevTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    if (prevTLS === undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 4000,
    });

    try {
      await client.connect();
      const result = await client.query("select current_database() as db");
      return { ok: true, db: result.rows?.[0]?.db ?? "unknown" };
    } catch (e) {
      const error = e as Error;
      logJSON({ service: "api", event: "pg_error", message: error.message });
      return { ok: false, error: error.message ?? "unknown" };
    } finally {
      try {
        await client.end();
      } catch {}
    }
  } finally {
    if (prevTLS === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTLS;
  }
}

import { createClient } from "@supabase/supabase-js";

export function getAdminClient() {
  const env = getEnv();

  const url = env.SUPABASE_URL; // ✅ use SUPABASE_URL, not NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key);
}
