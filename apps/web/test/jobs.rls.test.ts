import "../../../packages/shared/test/loadEnv"; // 👈 force env load first

import { getEnv } from "@cliply/shared/env";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { resetDatabase } from "../../../packages/shared/test/setup"; // 👈 fixed path manually

// ✅ Load environment
const env = getEnv();

if (!env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL missing for RLS test");
}
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY missing for RLS test");
}

const JWT_A = process.env.SUPABASE_JWT_A;
const JWT_B = process.env.SUPABASE_JWT_B;

if (!JWT_A || !JWT_B) {
  throw new Error("SUPABASE_JWT_A and SUPABASE_JWT_B must be set in the test environment");
}

// Workspace IDs tied to JWT claims
const workspaceA = "00000000-0000-0000-0000-000000000001";

// ✅ Create Supabase clients for each workspace
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

    // ✅ Either an error OR simply no data (RLS block)
    expect(blockedRow).toBeNull();

    const { data: updatedRows } = await clientB
      .from("jobs")
      .update({ state: "done" })
      .eq("workspace_id", workspaceA)
      .select();

    // ✅ RLS: update should affect 0 rows
    expect(updatedRows?.length ?? 0).toBe(0);
  });
});
