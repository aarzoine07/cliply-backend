import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import accountsRoute from "../../src/pages/api/accounts";
import { supertestHandler } from "../../../../test/utils/supertest-next";

import fs from "fs";
import { SignJWT } from "jose";

const toApiHandler = (handler: typeof accountsRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const WKA = "123e4567-e89b-12d3-a456-426614174000";
const USA = "123e4567-e89b-12d3-a456-426614174001";

const WKC = "123e4567-e89b-12d3-a456-426614174200";
const USERC = "123e4567-e89b-12d3-a456-426614174201";

function readJwtSecretFromSupabaseConfig(): Buffer {
  const tomlPath = path.resolve(__dirname, "../../../../supabase/config.toml");
  const toml = fs.readFileSync(tomlPath, "utf8");
  const m = toml.match(/^jwt_secret\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("jwt_secret not found in supabase/config.toml");
  return Buffer.from(m[1], "utf8");
}

async function makeJwt(opts: {
  userId: string;
  workspaceId: string;
  issuer: string;
  secret: Buffer;
}): Promise<string> {
  const { userId, workspaceId, issuer, secret } = opts;
  return await new SignJWT({
    role: "authenticated",
    sub: userId,
    workspace_id: workspaceId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }) // IMPORTANT: no kid
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

async function seedConnectedAccountViaServiceRole(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const restUrl =
    process.env.SUPABASE_REST_URL ??
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/rest/v1` : null);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!restUrl) throw new Error("Missing SUPABASE_URL (or SUPABASE_REST_URL) in env");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env");

  const ts = Math.floor(Date.now() / 1000);

  const res = await fetch(`${restUrl}/connected_accounts?on_conflict=workspace_id,platform`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      workspace_id: WKA,
      user_id: USA,
      provider: "google",
      external_id: `channel-a-${ts}`,
      platform: "youtube",
      status: "active",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seed failed: ${res.status} ${res.statusText} :: ${text}`);
  }
}

async function seedWorkspaceMemberViaServiceRole(opts: {
  workspaceId: string;
  userId: string;
  role?: "owner" | "member";
}): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const restUrl =
    process.env.SUPABASE_REST_URL ??
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/rest/v1` : null);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!restUrl) throw new Error("Missing SUPABASE_URL (or SUPABASE_REST_URL) in env");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env");

  const res = await fetch(`${restUrl}/workspace_members?on_conflict=workspace_id,user_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      role: opts.role ?? "member",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seed workspace_members failed: ${res.status} ${res.statusText} :: ${text}`);
  }
}

describe("T2 RLS: /api/accounts (connected_accounts)", () => {
  let jwtA = "";
  let jwtC = "";

  beforeAll(async () => {
    await seedConnectedAccountViaServiceRole();
    await seedWorkspaceMemberViaServiceRole({ workspaceId: WKA, userId: USA, role: "member" });

    const secret = readJwtSecretFromSupabaseConfig();
    const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;

    jwtA = await makeJwt({ userId: USA, workspaceId: WKA, issuer, secret });
    jwtC = await makeJwt({ userId: USERC, workspaceId: WKC, issuer, secret });
  });

  it("A (workspace member) can read connected accounts in workspace A", async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), "get")
      .get("/")
      .set("x-debug-user", USA)
      .set("x-debug-workspace", WKA)
      .set("authorization", `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("data.accounts");
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
    expect(res.body.data.accounts.length).toBeGreaterThanOrEqual(1);
  });

  it("C (NOT a member) is blocked by RLS (reads empty) when targeting workspace A", async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), "get")
      .get("/")
      .set("x-debug-user", USERC)
      .set("x-debug-workspace", WKA) // target workspace A
      .set("authorization", `Bearer ${jwtC}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("data.accounts");
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
    expect(res.body.data.accounts).toEqual([]);
  });
});
