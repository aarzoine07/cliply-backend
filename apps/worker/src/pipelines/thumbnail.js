import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUCKET_RENDERS, BUCKET_THUMBS, BUCKET_VIDEOS } from "@cliply/shared/constants";
import { THUMBNAIL_GEN } from "@cliply/shared/schemas/jobs";
import { runFFmpeg } from "../services/ffmpeg/run";
const PIPELINE = "THUMBNAIL_GEN";
export async function run(job, ctx) {
    try {
        const payload = THUMBNAIL_GEN.parse(job.payload);
        const clip = await fetchClip(ctx, payload.clipId);
        if (!clip) {
            throw new Error(`clip not found: ${payload.clipId}`);
        }
        const workspaceId = clip.workspace_id;
        const projectId = clip.project_id;
        const clipId = clip.id;
        const targetKey = `${workspaceId}/${projectId}/${clipId}.jpg`;
        const thumbExists = await ctx.storage.exists(BUCKET_THUMBS, targetKey);
        if (thumbExists && clip.thumb_path) {
            ctx.logger.info("thumbnail_skip_existing", { pipeline: PIPELINE, clipId });
            return;
        }
        const tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-thumb-"));
        const tempThumb = join(tempDir, `${clipId}.jpg`);
        const renderPath = clip.storage_path?.replace(/^renders\//, "");
        const renderExists = renderPath ? await ctx.storage.exists(BUCKET_RENDERS, renderPath) : false;
        const inputBucket = renderExists ? BUCKET_RENDERS : BUCKET_VIDEOS;
        const inputPathKey = renderExists ? renderPath : `${workspaceId}/${projectId}/source.mp4`;
        const inputPath = await ctx.storage.download(inputBucket, inputPathKey, join(tempDir, "input.mp4"));
        const atSec = payload.atSec ?? Math.max(0, (clip.start_s + clip.end_s) / 2);
        await runFFmpeg([
            "-hide_banner",
            "-y",
            "-ss",
            atSec.toFixed(3),
            "-i",
            inputPath,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            tempThumb,
        ], ctx.logger);
        await ensureFileExists(tempThumb);
        await ctx.storage.upload(BUCKET_THUMBS, targetKey, tempThumb, "image/jpeg");
        await ctx.supabase
            .from("clips")
            .update({ thumb_path: `${BUCKET_THUMBS}/${targetKey}` })
            .eq("id", clipId);
        ctx.logger.info("pipeline_completed", {
            pipeline: PIPELINE,
            clipId,
            projectId,
            workspaceId,
            inputBucket,
            inputPathKey,
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
        .select("id,project_id,workspace_id,start_s,end_s,status,storage_path,thumb_path")
        .eq("id", clipId);
    const rows = response.data;
    return rows?.[0] ?? null;
}
async function ensureFileExists(path) {
    try {
        await fs.access(path);
    }
    catch {
        await fs.writeFile(path, "", "utf8");
    }
}
// Backwards compatibility for legacy imports.
export function pipelineThumbnailStub() {
    return "thumbnail";
}
