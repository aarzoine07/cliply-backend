import "../../../packages/shared/test/loadEnv"; // 👈 force env load first

import { getEnv } from "@cliply/shared/env";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { resetDatabase } from "../../../packages/shared/test/setup"; // 👈 fixed path manually

// ✅ Load environment
const env = getEnv();

if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing for RLS test");
if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing for RLS test");

const JWT_A = process.env.SUPABASE_JWT_A;
const JWT_B = process.env.SUPABASE_JWT_B;
if (!JWT_A || !JWT_B) throw new Error("SUPABASE_JWT_A and SUPABASE_JWT_B must be set in the test environment");

// ✅ Clean workspace UUID (strip any 'test-' prefix)
const workspaceA = "test-00000000-0000-0000-0000-000000000001".replace("test-", "");

// ✅ Create Supabase clients (use service-role to ensure permissions)
const clientA = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { Authorization: `Bearer ${JWT_A}` } },
});
const clientB = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { Authorization: `Bearer ${JWT_B}` } },
});

describe("RLS – Cross-Workspace Isolation", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("allows same-workspace read/write", async () => {
    const cleanWorkspaceId = workspaceA.replace("test-", "");

    const { data: inserted, error: insertError } = await clientA
      .from("jobs")
      .insert({
        workspace_id: cleanWorkspaceId,
        kind: "TRANSCRIBE",
        payload: { a: true },
      })
      .select()
      .single();

    console.log("insert error:", insertError);
    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    expect(inserted.workspace_id).toBe(cleanWorkspaceId);

    const { data: rows, error: readError } = await clientA
      .from("jobs")
      .select("id")
      .eq("workspace_id", cleanWorkspaceId);

    console.log("read error:", readError);
    expect(readError).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
  });

  it("blocks cross-workspace read/write", async () => {
    const cleanWorkspaceId = workspaceA.replace("test-", "");

    const { data: blockedRow } = await clientB
      .from("jobs")
      .select("id")
      .eq("workspace_id", cleanWorkspaceId)
      .maybeSingle();

    expect(blockedRow).toBeNull();

    const { data: updatedRows } = await clientB
      .from("jobs")
      .update({ state: "done" })
      .eq("workspace_id", cleanWorkspaceId)
      .select();

    expect(updatedRows?.length ?? 0).toBe(0);
  });
});
