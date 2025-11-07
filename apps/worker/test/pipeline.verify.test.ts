import { beforeAll, describe, expect, it } from "vitest";
import { supabaseTest, resetDatabase } from "@cliply/shared/test/setup";

const SEEDED_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const SEEDED_USER_ID = "00000000-0000-0000-0000-000000000101";
const SEEDED_PROJECT_ID = "00000000-0000-0000-0000-000000000201";
const WORKER_ID = "e2e-verify-worker";

describe("E2E pipeline verification", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("verifies seeded workspace, user, and project exist", async () => {
    const { data: workspace, error: workspaceError } = await supabaseTest
      .from("workspaces")
      .select("*")
      .eq("id", SEEDED_WORKSPACE_ID)
      .single();

    expect(workspaceError).toBeNull();
    expect(workspace).toBeTruthy();
    expect(workspace?.name).toBe("Dev Workspace");
    expect(workspace?.owner_id).toBe(SEEDED_USER_ID);

    const { data: user, error: userError } = await supabaseTest
      .from("users")
      .select("*")
      .eq("id", SEEDED_USER_ID)
      .single();

    expect(userError).toBeNull();
    expect(user).toBeTruthy();
    expect(user?.email).toBe("dev@cliply.ai");

    const { data: project, error: projectError } = await supabaseTest
      .from("projects")
      .select("*")
      .eq("id", SEEDED_PROJECT_ID)
      .single();

    expect(projectError).toBeNull();
    expect(project).toBeTruthy();
    expect(project?.workspace_id).toBe(SEEDED_WORKSPACE_ID);
    expect(project?.title).toBe("Test Project");
    expect(project?.source_type).toBe("file");
    expect(project?.source_path).toBe("/test-assets/sample.mp4");
    expect(project?.status).toBe("queued");
  });

  it("enqueues TRANSCRIBE job for seeded project", async () => {
    const enqueuePayload = {
      workspace_id: SEEDED_WORKSPACE_ID,
      kind: "TRANSCRIBE",
      payload: {
        projectId: SEEDED_PROJECT_ID,
        sourceExt: "mp4",
      },
      priority: 10,
    };

    const { data: jobRow, error: enqueueError } = await supabaseTest
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(enqueueError).toBeNull();
    expect(jobRow).toBeTruthy();
    expect(jobRow.state).toBe("queued");
    expect(jobRow.kind).toBe("TRANSCRIBE");
    expect(jobRow.workspace_id).toBe(SEEDED_WORKSPACE_ID);
  });

  it("worker can claim TRANSCRIBE job for seeded project", async () => {
    const enqueuePayload = {
      workspace_id: SEEDED_WORKSPACE_ID,
      kind: "TRANSCRIBE",
      payload: {
        projectId: SEEDED_PROJECT_ID,
        sourceExt: "mp4",
      },
      priority: 10,
    };

    const { data: jobRow, error: enqueueError } = await supabaseTest
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(enqueueError).toBeNull();

    const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
      p_worker_id: WORKER_ID,
    });

    expect(claimError).toBeNull();
    expect(claimed).toBeTruthy();
    expect(claimed?.id).toBe(jobRow.id);
    expect(claimed?.state).toBe("running");
    expect(claimed?.locked_by).toBe(WORKER_ID);
    expect(claimed?.kind).toBe("TRANSCRIBE");

    const { data: events, error: eventsError } = await supabaseTest
      .from("job_events")
      .select("stage")
      .eq("job_id", claimed.id)
      .order("created_at", { ascending: true });

    expect(eventsError).toBeNull();
    const stages = (events ?? []).map((event) => event.stage);
    expect(stages).toContain("claimed");
  });

  it("validates job system ready for full pipeline execution", async () => {
    const jobKinds = ["TRANSCRIBE", "HIGHLIGHT_DETECT", "CLIP_RENDER"];

    for (const kind of jobKinds) {
      const { data: jobRow, error: enqueueError } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: SEEDED_WORKSPACE_ID,
          kind,
          payload: { projectId: SEEDED_PROJECT_ID },
          priority: 5,
        })
        .select()
        .single();

      expect(enqueueError).toBeNull();
      expect(jobRow).toBeTruthy();
      expect(jobRow.state).toBe("queued");

      const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
        p_worker_id: `${WORKER_ID}-${kind}`,
      });

      expect(claimError).toBeNull();
      expect(claimed).toBeTruthy();
      expect(claimed?.kind).toBe(kind);

      const { error: finishError } = await supabaseTest.rpc("worker_finish", {
        p_job_id: claimed.id,
        p_worker_id: `${WORKER_ID}-${kind}`,
        p_result: { verified: true, kind },
      });

      expect(finishError).toBeNull();

      const { data: completed, error: completedError } = await supabaseTest
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

