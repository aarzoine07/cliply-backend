import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import accountsListRoute from "../../src/pages/api/accounts";
import accountPatchRoute from "../../src/pages/api/accounts/[id]";
import { supertestHandler } from "../../../../test/utils/supertest-next";

import fs from "fs";
import { SignJWT } from "jose";

const toApiHandler = (handler: any) =>
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

async function seedConnectedAccountViaServiceRole(): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const restUrl =
    process.env.SUPABASE_REST_URL ??
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/rest/v1` : null);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!restUrl) throw new Error("Missing SUPABASE_URL (or SUPABASE_REST_URL) in env");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env");

  const ts = Math.floor(Date.now() / 1000);

  const res = await fetch(
    `${restUrl}/connected_accounts?on_conflict=workspace_id,platform`,
    {
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
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seed failed: ${res.status} ${res.statusText} :: ${text}`);
  }

  const json = (await res.json()) as Array<{ id: string }>;
  const id = json?.[0]?.id;
  if (!id) throw new Error("Seed did not return id");
  return id;
}

describe("T2 RLS: PATCH /api/accounts/[id] (connected_accounts)", () => {
  let jwtA = "";
  let jwtC = "";
  let seededAccountId = "";

  beforeAll(async () => {
    seededAccountId = await seedConnectedAccountViaServiceRole();

    const secret = readJwtSecretFromSupabaseConfig();
    const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;

    jwtA = await makeJwt({ userId: USA, workspaceId: WKA, issuer, secret });
    jwtC = await makeJwt({ userId: USERC, workspaceId: WKC, issuer, secret });
  });

  it("A (workspace member) can update connected account status in workspace A", async () => {
    const patchRes = await supertestHandler(toApiHandler(accountPatchRoute), "patch")
      .patch(`/?id=${seededAccountId}`)
      .set("x-debug-user", USA)
      .set("x-debug-workspace", WKA)
      .set("authorization", `Bearer ${jwtA}`)
      .send({ status: "revoked" });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toHaveProperty("ok", true);

    const listRes = await supertestHandler(toApiHandler(accountsListRoute), "get")
      .get("/")
      .set("x-debug-user", USA)
      .set("x-debug-workspace", WKA)
      .set("authorization", `Bearer ${jwtA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveProperty("ok", true);
    expect(Array.isArray(listRes.body.data.accounts)).toBe(true);

    const acct = listRes.body.data.accounts.find((a: any) => a.id === seededAccountId);
    expect(acct).toBeTruthy();
    expect(acct.status).toBe("revoked");
  });

  it("C (NOT a member) is blocked by RLS when updating workspace A account", async () => {
    const res = await supertestHandler(toApiHandler(accountPatchRoute), "patch")
      .patch(`/?id=${seededAccountId}`)
      .set("x-debug-user", USERC)
      .set("x-debug-workspace", WKA) // target workspace A
      .set("authorization", `Bearer ${jwtC}`)
      .send({ status: "error" });

    // RLS should prevent the lookup/update; route maps this to not_found.
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("ok", false);
  });
});