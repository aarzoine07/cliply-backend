import { PUBLISH_YOUTUBE } from "@cliply/shared/schemas/jobs";
import { YouTubeClient } from "../services/youtube/client";
const PIPELINE = "PUBLISH_YOUTUBE";
export async function run(job, ctx) {
    try {
        const payload = PUBLISH_YOUTUBE.parse(job.payload);
        const clip = await fetchClip(ctx, payload.clipId);
        if (!clip) {
            throw new Error(`clip not found: ${payload.clipId}`);
        }
        if (clip.status !== "ready" || !clip.storage_path) {
            throw new Error(`clip not ready for publish: ${payload.clipId}`);
        }
        if (clip.external_id) {
            ctx.logger.info("publish_skip_existing", { pipeline: PIPELINE, clipId: payload.clipId });
            return;
        }
        const downloadPath = clip.storage_path.replace(/^renders\//, "");
        const tempPath = await ctx.storage.download("renders", downloadPath, downloadPath.split("/").pop() ?? "video.mp4");
        const youtube = new YouTubeClient({ accessToken: "dryrun" });
        const response = await youtube.uploadShort({
            filePath: tempPath,
            title: payload.title ?? "Cliply Short",
            description: payload.description,
            tags: payload.tags,
            visibility: payload.visibility,
        });
        await ctx.supabase
            .from("clips")
            .update({
            status: "published",
            external_id: response.videoId,
            published_at: new Date().toISOString(),
        })
            .eq("id", payload.clipId);
        await markScheduleSent(ctx, payload.clipId);
        ctx.logger.info("pipeline_completed", {
            pipeline: PIPELINE,
            clipId: payload.clipId,
            videoId: response.videoId,
            workspaceId: job.workspaceId,
        });
    }
    catch (error) {
        ctx.sentry.captureException(error, {
            tags: { pipeline: PIPELINE },
            extra: { jobId: String(job.id), workspaceId: job.workspaceId },
        });
        ctx.logger.error("pipeline_failed", {
            pipeline: PIPELINE,
            jobId: job.id,
            workspaceId: job.workspaceId,
            error: error?.message ?? String(error),
        });
        throw error;
    }
}
export const pipeline = { run };
async function fetchClip(ctx, clipId) {
    const response = await ctx.supabase
        .from("clips")
        .select("id,project_id,workspace_id,status,storage_path,external_id")
        .eq("id", clipId);
    const rows = response.data;
    return rows?.[0] ?? null;
}
async function markScheduleSent(ctx, clipId) {
    const response = await ctx.supabase
        .from("schedules")
        .select("id,status,provider")
        .eq("clip_id", clipId)
        .eq("provider", "youtube");
    const rows = response.data;
    const schedule = rows?.find((row) => row.status === "queued");
    if (!schedule) {
        return;
    }
    await ctx.supabase
        .from("schedules")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", schedule.id);
}
// Backwards compatibility for legacy imports.
export function pipelinePublishYouTubeStub() {
    return "publish";
}
