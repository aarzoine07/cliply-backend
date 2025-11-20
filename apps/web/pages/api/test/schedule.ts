import type { NextApiRequest, NextApiResponse } from "next";
import { withPlanGate } from "../../../src/middleware/planGate";
import { createClient } from "@supabase/supabase-js";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Prefer query param for testing, fallback to cookie
const workspace_id =
(req.query.workspaceId as string) ||
req.cookies["wsid"];

  if (!workspace_id) {
    return res.status(400).json({
      ok: false,
      error: { code: "WORKSPACE_REQUIRED", message: "Workspace ID required" },
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase configuration missing in /api/test/schedule");
    return res.status(500).json({
      ok: false,
      error: { code: "SUPABASE_CONFIG_MISSING", message: "Supabase config missing" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Find any clip in this workspace to attach the schedule to
  const { data: clip, error: clipErr } = await supabase
    .from("clips")
    .select("id")
    .eq("workspace_id", workspace_id)
    .limit(1)
    .maybeSingle();

  if (clipErr) {
    console.error("Failed to fetch test clip for schedule:", clipErr);
    return res.status(500).json({
      ok: false,
      error: { code: "CLIP_LOOKUP_FAILED", message: "Failed to fetch test clip" },
    });
  }

  if (!clip) {
    return res.status(500).json({
      ok: false,
      error: { code: "NO_TEST_CLIP", message: "No clip found in workspace for schedule test" },
    });
  }

  const runAt = new Date().toISOString();

  const { data: schedule, error: schedErr } = await supabase
    .from("schedules")
    .insert({
      workspace_id,
      clip_id: clip.id,
      run_at: runAt,
    })
    .select("id, run_at")
    .single();

  if (schedErr) {
    console.error("Failed to insert schedule in test endpoint:", schedErr);
    return res.status(500).json({
      ok: false,
      error: { code: "SCHEDULE_INSERT_FAILED", message: "Failed to insert schedule" },
    });
  }

  return res.status(200).json({
    ok: true,
    data: {
      scheduled: true,
      schedule_id: schedule.id,
      run_at: schedule.run_at,
    },
  });
}

export default withPlanGate(handler, "schedule");
