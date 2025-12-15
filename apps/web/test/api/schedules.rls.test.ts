import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import schedulesRoute from "../../src/pages/api/schedules";
import { supertestHandler } from "../../../../test/utils/supertest-next";

import fs from "fs";
import { SignJWT } from "jose";

const toApiHandler = (handler: typeof schedulesRoute) =>
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

async function seedScheduleViaServiceRole(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const restUrl =
    process.env.SUPABASE_REST_URL ??
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/rest/v1` : null);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!restUrl) throw new Error("Missing SUPABASE_URL (or SUPABASE_REST_URL) in env");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env");

  const ts = Math.floor(Date.now() / 1000);

  // 1) Seed project
  const prjRes = await fetch(`${restUrl}/projects`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      workspace_id: WKA,
      title: `t2-schedules-project-${ts}`,
      source_type: "youtube",
      source_path: `https://example.com/${ts}`,
      status: "queued",
    }),
  });
  if (!prjRes.ok) {
    const text = await prjRes.text();
    throw new Error(`Seed project failed: ${prjRes.status} ${prjRes.statusText} :: ${text}`);
  }
  const prjJson = (await prjRes.json()) as Array<{ id: string }>;
  const projectId = prjJson?.[0]?.id;
  if (!projectId) throw new Error("Seed project did not return id");

  // 2) Seed clip
  const clipRes = await fetch(`${restUrl}/clips`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      workspace_id: WKA,
      project_id: projectId,
      title: `t2-schedules-clip-${ts}`,
      status: "proposed",
    }),
  });
  if (!clipRes.ok) {
    const text = await clipRes.text();
    throw new Error(`Seed clip failed: ${clipRes.status} ${clipRes.statusText} :: ${text}`);
  }
  const clipJson = (await clipRes.json()) as Array<{ id: string }>;
  const clipId = clipJson?.[0]?.id;
  if (!clipId) throw new Error("Seed clip did not return id");

  // 3) Seed schedule
  const runAt = new Date(Date.now() + 60_000).toISOString();
  const schRes = await fetch(`${restUrl}/schedules`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      workspace_id: WKA,
      clip_id: clipId,
      run_at: runAt,
      platform: "youtube",
      status: "scheduled",
    }),
  });
  if (!schRes.ok) {
    const text = await schRes.text();
    throw new Error(`Seed schedule failed: ${schRes.status} ${schRes.statusText} :: ${text}`);
  }
}

describe("T2 RLS: /api/schedules (schedules)", () => {
  let jwtA = "";
  let jwtC = "";

  beforeAll(async () => {
    await seedScheduleViaServiceRole();

    const secret = readJwtSecretFromSupabaseConfig();
    const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;

    jwtA = await makeJwt({ userId: USA, workspaceId: WKA, issuer, secret });
    jwtC = await makeJwt({ userId: USERC, workspaceId: WKC, issuer, secret });
  });

  it("A (workspace member) can read schedules in workspace A", async () => {
    const res = await supertestHandler(toApiHandler(schedulesRoute), "get")
      .get("/")
      .set("x-debug-user", USA)
      .set("x-debug-workspace", WKA)
      .set("authorization", `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("data.items");
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it("C (NOT a member) is blocked by RLS (reads empty) when targeting workspace A", async () => {
    const res = await supertestHandler(toApiHandler(schedulesRoute), "get")
      .get("/")
      .set("x-debug-user", USERC)
      .set("x-debug-workspace", WKA) // target workspace A
      .set("authorization", `Bearer ${jwtC}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("data.items");
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items).toEqual([]);
  });
});
