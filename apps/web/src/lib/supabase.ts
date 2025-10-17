import { getEnv } from "../../../../packages/shared/env";
import { logJSON } from "../../../../packages/shared/logger";
import { Client } from "pg";

function addSslmodeRequire(url: string): string {
  if (!url) return url;
  if (url.includes("?")) return url.includes("sslmode=") ? url : url + "&sslmode=require";
  return url + "?sslmode=require";
}

export async function pgCheck(): Promise<{ ok: boolean; db?: string; error?: string }> {
  const { DATABASE_URL } = getEnv();

  // Ensure sslmode=require at runtime (in-memory only)
  const url = addSslmodeRequire(DATABASE_URL);

  // Scope TLS relaxers to this function only
  const prevTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    if (prevTLS === undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const client = new Client({
      connectionString: url,
      ssl: { require: true, rejectUnauthorized: false },
      connectionTimeoutMillis: 4000,
    });

    try {
      await client.connect();
      const r = await client.query("select current_database() as db");
      return { ok: true, db: r.rows?.[0]?.db ?? "unknown" };
    } catch (e: any) {
      logJSON({ service: "api", event: "pg_error", message: e?.message });
      return { ok: false, error: e?.message ?? "unknown" };
    } finally {
      try { await client.end(); } catch {}
    }
  } finally {
    // restore process env
    if (prevTLS === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTLS;
  }
}


