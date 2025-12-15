import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { supabaseTest, resetDatabase } from "@cliply/shared/test/setup";

const SEEDED_WORKSPACE_ID = "00000000-0000-0000-0000-000000000101";
const SEEDED_USER_ID = "00000000-0000-0000-0000-000000000101";
const SEEDED_PROJECT_ID = "00000000-0000-0000-0000-000000000201";
const WORKER_ID = "00000000-0000-0000-0000-000000000999";

const SEEDED_EMAIL = "dev@cliply.ai";
const SEEDED_WORKSPACE_NAME = "Dev Workspace";
const SEEDED_PROJECT_TITLE = "Test Project";
const SEEDED_PROJECT_SOURCE_TYPE = "file";
const SEEDED_PROJECT_SOURCE_PATH = "/test-assets/sample.mp4";

function requireSupabase() {
  if (!supabaseTest) {
    throw new Error("supabaseTest is null — check .env.test and @cliply/shared/test/setup");
  }
  return supabaseTest;
}

describe("E2E pipeline verification", () => {
  beforeAll(async () => {
    const supabase = requireSupabase();

    // Ensure the "seeded" entities exist for this test suite.
    // Using upsert makes this idempotent across runs.
    const { error: userSeedError } = await supabase
      .from("users")
      .upsert(
        {
          id: SEEDED_USER_ID,
          email: SEEDED_EMAIL,
        },
        { onConflict: "id" },
      );

    if (userSeedError) throw userSeedError;

    const { error: workspaceSeedError } = await supabase
      .from("workspaces")
      .upsert(
        {
          id: SEEDED_WORKSPACE_ID,
          name: SEEDED_WORKSPACE_NAME,
          owner_id: SEEDED_USER_ID,
        },
        { onConflict: "id" },
      );

    if (workspaceSeedError) throw workspaceSeedError;

    const { error: projectSeedError } = await supabase
      .from("projects")
      .upsert(
        {
          id: SEEDED_PROJECT_ID,
          workspace_id: SEEDED_WORKSPACE_ID,
          title: SEEDED_PROJECT_TITLE,
          source_type: SEEDED_PROJECT_SOURCE_TYPE,
          source_path: SEEDED_PROJECT_SOURCE_PATH,
          status: "queued",
        },
        { onConflict: "id" },
      );

    if (projectSeedError) throw projectSeedError;
  });

  beforeEach(async () => {
    // Prevent any job leakage between tests in this file
    await resetDatabase?.();
  });

  it("verifies seeded workspace, user, and project exist", async () => {
    const supabase = requireSupabase();

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", SEEDED_WORKSPACE_ID)
      .single();

    expect(workspaceError).toBeNull();
    expect(workspace).toBeTruthy();
    expect(workspace?.name).toBe(SEEDED_WORKSPACE_NAME);
    expect(workspace?.owner_id).toBe(SEEDED_USER_ID);

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", SEEDED_USER_ID)
      .single();

    expect(userError).toBeNull();
    expect(user).toBeTruthy();
    expect(user?.email).toBe(SEEDED_EMAIL);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", SEEDED_PROJECT_ID)
      .single();

    expect(projectError).toBeNull();
    expect(project).toBeTruthy();
    expect(project?.workspace_id).toBe(SEEDED_WORKSPACE_ID);
    expect(project?.title).toBe(SEEDED_PROJECT_TITLE);
    expect(project?.source_type).toBe(SEEDED_PROJECT_SOURCE_TYPE);
    expect(project?.source_path).toBe(SEEDED_PROJECT_SOURCE_PATH);
    expect(project?.status).toBe("queued");
  });

  it("enqueues TRANSCRIBE job for seeded project", async () => {
    const supabase = requireSupabase();

    const enqueuePayload = {
      workspace_id: SEEDED_WORKSPACE_ID,
      kind: "TRANSCRIBE",
      payload: {
        projectId: SEEDED_PROJECT_ID,
        sourceExt: "mp4",
      },
      // keep normal priority here; this test doesn't claim
      priority: 10,
    };

    const { data: jobRow, error: enqueueError } = await supabase
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(enqueueError).toBeNull();
    expect(jobRow).toBeTruthy();
    expect(jobRow?.state).toBe("queued");
    expect(jobRow?.kind).toBe("TRANSCRIBE");
    expect(jobRow?.workspace_id).toBe(SEEDED_WORKSPACE_ID);
  });

  it("worker can claim TRANSCRIBE job for seeded project", async () => {
    const supabase = requireSupabase();

    const enqueuePayload = {
      workspace_id: SEEDED_WORKSPACE_ID,
      kind: "TRANSCRIBE",
      payload: {
        projectId: SEEDED_PROJECT_ID,
        sourceExt: "mp4",
      },
      // Make this unambiguously the next job to claim
      priority: 10_000,
      run_at: new Date(0).toISOString(),
    };

    const { data: jobRow, error: enqueueError } = await supabase
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(enqueueError).toBeNull();
    expect(jobRow).toBeTruthy();
    if (!jobRow) throw new Error("jobRow is null");

    const { data: claimed, error: claimError } = await supabase.rpc("worker_claim_next_job", {
      p_worker_id: WORKER_ID,
    });

    expect(claimError).toBeNull();
    expect(claimed).toBeTruthy();
    if (!claimed) throw new Error("claimed job is null");

    expect(claimed.id).toBe(jobRow.id);
    expect(claimed.state).toBe("running");

    // ✅ Worker id is stored as locked_by in this system (some responses may also include worker_id)
    const claimedWorker = (claimed as any).locked_by ?? (claimed as any).worker_id;
    expect(claimedWorker).toBe(WORKER_ID);

    expect(claimed.kind).toBe("TRANSCRIBE");

    const { data: events, error: eventsError } = await supabase
      .from("job_events")
      .select("stage")
      .eq("job_id", claimed.id)
      .order("created_at", { ascending: true });

    expect(eventsError).toBeNull();
    const stages = (events ?? []).map((event) => event.stage);
    expect(stages).toContain("claimed");
  });

  it("validates job system ready for full pipeline execution", async () => {
    const supabase = requireSupabase();

    const jobKinds = ["TRANSCRIBE", "HIGHLIGHT_DETECT", "CLIP_RENDER"] as const;

    for (const kind of jobKinds) {
      const { data: jobRow, error: enqueueError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: SEEDED_WORKSPACE_ID,
          kind,
          payload: { projectId: SEEDED_PROJECT_ID },
          // Make this unambiguously the next job to claim
          priority: 10_000,
          run_at: new Date(0).toISOString(),
        })
        .select()
        .single();

      expect(enqueueError).toBeNull();
      expect(jobRow).toBeTruthy();
      if (!jobRow) throw new Error("jobRow is null");
      expect(jobRow.state).toBe("queued");

      const { data: claimed, error: claimError } = await supabase.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      expect(claimed).toBeTruthy();
      if (!claimed) throw new Error("claimed job is null");

      // Ensure we claimed the exact row we inserted
      expect(claimed.id).toBe(jobRow.id);
      expect(claimed.kind).toBe(kind);

      const { error: finishError } = await supabase.rpc("worker_finish", {
        p_job_id: claimed.id,
        p_worker_id: WORKER_ID,
        p_result: { verified: true, kind },
      });

      expect(finishError).toBeNull();

      const { data: completed, error: completedError } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", claimed.id)
        .single();

      expect(completedError).toBeNull();
      expect(completed?.state).toBe("done");
      expect(completed?.result).toMatchObject({ verified: true, kind });
    }
  });
});