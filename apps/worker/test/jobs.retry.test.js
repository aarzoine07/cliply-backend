import { beforeAll, describe, expect, it } from "vitest";
import { supabaseTest, resetDatabase } from "@cliply/shared/test/setup";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKER_ID = "retry-worker";
const MAX_ATTEMPTS = 5;
describe("Background Job System – Retry & Backoff", () => {
    beforeAll(async () => {
        await resetDatabase?.();
    });
    it("retries failed job and ends in error after max attempts", async () => {
        const enqueuePayload = {
            workspace_id: WORKSPACE_ID,
            kind: "CLIP_RENDER",
            payload: { test: true },
            priority: 5,
            max_attempts: MAX_ATTEMPTS,
        };
        const { data: inserted, error: insertError } = await supabaseTest
            .from("jobs")
            .insert(enqueuePayload)
            .select()
            .single();
        expect(insertError).toBeNull();
        expect(inserted).toBeTruthy();
        expect(inserted.state).toBe("queued");
        let jobState = inserted;
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
                p_worker_id: WORKER_ID,
            });
            expect(claimError).toBeNull();
            expect(claimed?.id).toBe(jobState.id);
            expect(claimed?.state).toBe("running");
            const attempts = claimed?.attempts ?? 1;
            const expectedBackoff = Math.min(2 ** (attempts - 1) * 10, 1800);
            const { error: failError } = await supabaseTest.rpc("worker_fail", {
                p_job_id: claimed.id,
                p_worker_id: WORKER_ID,
                p_error: `Simulated failure #${attempts}`,
                p_backoff_seconds: expectedBackoff,
            });
            expect(failError).toBeNull();
            const { data: refreshed, error: refreshError } = await supabaseTest
                .from("jobs")
                .select("state, attempts, last_error, run_at")
                .eq("id", jobState.id)
                .single();
            expect(refreshError).toBeNull();
            expect(refreshed).toBeTruthy();
            if (refreshed.attempts >= MAX_ATTEMPTS) {
                expect(refreshed.state).toBe("error");
                jobState = refreshed;
                break;
            }
            expect(refreshed.state).toBe("queued");
            const expectedRunAt = new Date(claimed.run_at);
            expectedRunAt.setSeconds(expectedRunAt.getSeconds() + expectedBackoff);
            const newRunAt = new Date(refreshed.run_at);
            expect(newRunAt.getTime()).toBeGreaterThan(expectedRunAt.getTime() - 500);
            jobState = refreshed;
        }
        const { data: events, error: eventsError } = await supabaseTest
            .from("job_events")
            .select("stage")
            .eq("job_id", jobState.id);
        expect(eventsError).toBeNull();
        const stages = (events ?? []).map((event) => event.stage);
        expect(stages).toContain("retry_scheduled");
        expect(stages).toContain("error");
    });
});
