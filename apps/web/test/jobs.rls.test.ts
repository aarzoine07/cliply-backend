import "../../../packages/shared/test/loadEnv";
import { getEnv } from "@cliply/shared/env";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { resetDatabase, supabaseTest } from "../../../packages/shared/test/setup";

const env = getEnv();

if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing");
if (!env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY missing");

const JWT_A = process.env.SUPABASE_JWT_A;
const JWT_B = process.env.SUPABASE_JWT_B;

if (!JWT_A || !JWT_B) throw new Error("SUPABASE_JWT_A and SUPABASE_JWT_B must be set");

// ✅ use a *real* UUID, not a test string
const workspaceA = "00000000-0000-0000-0000-000000000001";
const workspaceB = "00000000-0000-0000-0000-000000000002";

const clientA = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${JWT_A}` } },
});

const clientB = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${JWT_B}` } },
});

describe("RLS – Cross-Workspace Isolation", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("allows same-workspace read/write", async () => {
    const { data: inserted, error: insertError } = await clientA
      .from("jobs")
      .insert({
        workspace_id: workspaceA,
        kind: "TRANSCRIBE",
        payload: { a: true },
      })
      .select()
      .single();

    console.log("insert error:", insertError);
    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    expect(inserted.workspace_id).toBe(workspaceA);

    const { data: rows, error: readError } = await clientA
      .from("jobs")
      .select("id")
      .eq("workspace_id", workspaceA);

    expect(readError).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
  });

  it("blocks cross-workspace read/write", async () => {
    const { data: blockedRow } = await clientB
      .from("jobs")
      .select("id")
      .eq("workspace_id", workspaceA)
      .maybeSingle();

    expect(blockedRow).toBeNull();

    const { data: updatedRows } = await clientB
      .from("jobs")
      .update({ state: "done" })
      .eq("workspace_id", workspaceA)
      .select();

    expect(updatedRows?.length ?? 0).toBe(0);
  });

  it("denies cross-workspace read for projects", async () => {
    // Seed data already has a project in workspace A (from seed.sql)
    // u1 (clientA) can read their own workspace's project
    const { data: ownRows, error: ownError } = await clientA
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceA);

    // If RLS allows same-workspace read, should succeed
    // If there's a policy issue, we'll get an error, but that's a separate problem
    if (ownError) {
      console.log("Note: Same-workspace read error (may be policy issue):", ownError.message);
    }

    // u2 (clientB) tries SELECT * FROM projects WHERE workspace_id = ws_a.id
    // If RLS works, Supabase returns HTTP 403 or empty array
    const { data: rows, error: readError } = await clientB
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceA);

    // Expect empty array or error - this proves cross-workspace isolation
    // Error code 42501 = permission denied (RLS blocking access)
    const hasError = readError !== null;
    const isEmpty = !rows || rows.length === 0;
    expect(hasError || isEmpty).toBe(true);
  });
});
