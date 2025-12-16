// @ts-nocheck
import * as path from "path";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDatabase } from "@cliply/shared/test/setup";
import { logAuditEvent } from "@cliply/shared/logging/audit";

// apps/web/test/api/audit-logging.test.ts

const dotenv = require("dotenv");

// Load .env.test
dotenv.config({ path: "../../.env.test", override: true });

const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);

// Supabase service-role client
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Seeded IDs
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

// NOTE: actor is resolved dynamically from the database to satisfy FK
let ACTOR_ID: string | null = null;

// Valid UUIDs ONLY — must match seed.sql
const TARGET_ID = "00000000-0000-0000-0000-000000000003";
const BILLING_TARGET_ID = "00000000-0000-0000-0000-000000000301";

describe("🧩 Audit Logging", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    // Resolve a real user from the seeded database so FK passes
    const { data: users, error } = await client
      .from("users")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Failed to load user for ACTOR_ID in audit tests", error);
      throw error;
    }

    if (!users || users.length === 0) {
      throw new Error("No users found in database for audit logging tests");
    }

    ACTOR_ID = users[0].id;
    console.log("✅ Using ACTOR_ID for audit tests:", ACTOR_ID);
  });

  it("inserts audit event into events_audit table", async () => {
    await logAuditEvent({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      eventType: "oauth",
      action: "connected_account.linked",
      targetId: TARGET_ID,
      meta: {
        provider: "tiktok",
        test: true,
      },
    });

    const { data: events, error } = await client
      .from("events_audit")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("event_type", "oauth")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(events).toBeTruthy();
    expect(events?.length).toBeGreaterThan(0);

    const event = events?.[0];
    expect(event).toBeTruthy();
    expect(event?.workspace_id).toBe(WORKSPACE_ID);
    expect(event?.actor_id).toBe(ACTOR_ID);
    expect(event?.event_type).toBe("oauth");
    expect(event?.target_id).toBe(TARGET_ID);
    expect(event?.payload?.action).toBe("connected_account.linked");
    expect(event?.payload?.meta?.provider).toBe("tiktok");
    expect(event?.payload?.meta?.test).toBe(true);
  });

  it("handles billing audit events", async () => {
    await logAuditEvent({
      workspaceId: WORKSPACE_ID,
      actorId: null,
      eventType: "billing",
      action: "subscription.created",
      targetId: BILLING_TARGET_ID, // ✅ valid UUID
      meta: {
        stripe_event_id: "evt_test123",
        stripe_subscription_id: BILLING_TARGET_ID, // keep consistent
        plan: "pro",
        status: "active",
      },
    });

    const { data: events, error } = await client
      .from("events_audit")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("event_type", "billing")
      .eq("target_id", BILLING_TARGET_ID)
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(events).toBeTruthy();
    expect(events?.length).toBeGreaterThan(0);

    const event = events?.[0];
    expect(event?.event_type).toBe("billing");
    expect(event?.actor_id).toBeNull();
    expect(event?.payload?.action).toBe("subscription.created");
    expect(event?.payload?.meta?.plan).toBe("pro");
    expect(event?.payload?.meta?.status).toBe("active");
  });
});

