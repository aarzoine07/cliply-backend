import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUCKET_RENDERS, BUCKET_THUMBS, BUCKET_TRANSCRIPTS, BUCKET_VIDEOS, EXTENSION_MIME_MAP, } from "@cliply/shared/constants";
import { CLIP_RENDER } from "@cliply/shared/schemas/jobs";
import { buildRenderCommand } from "../services/ffmpeg/build-commands";
import { runFFmpeg } from "../services/ffmpeg/run";
const PIPELINE = "CLIP_RENDER";
export async function run(job, ctx) {
    try {
        const payload = CLIP_RENDER.parse(job.payload);
        const clip = await fetchClip(ctx, payload.clipId);
        if (!clip) {
            throw new Error(`clip not found: ${payload.clipId}`);
        }
        const project = await fetchProject(ctx, clip.project_id);
        if (!project) {
            throw new Error(`project not found: ${clip.project_id}`);
        }
        const workspaceId = clip.workspace_id;
        const projectId = clip.project_id;
        const clipId = clip.id;
        const sourceKey = await resolveSourceKey(ctx, workspaceId, projectId);
        const subtitlesKey = `${workspaceId}/${projectId}/transcript.srt`;
        const videoKey = `${workspaceId}/${projectId}/${clipId}.mp4`;
        const thumbKey = `${workspaceId}/${projectId}/${clipId}.jpg`;
        const videoExists = await ctx.storage.exists(BUCKET_RENDERS, videoKey);
        if (videoExists && clip.status === "ready") {
            ctx.logger.info("render_skip_ready", { pipeline: PIPELINE, clipId });
            return;
        }
        const tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-render-"));
        const tempVideo = join(tempDir, `${clipId}.mp4`);
        const tempThumb = join(tempDir, `${clipId}.jpg`);
        const subtitlesPath = (await ctx.storage.exists(BUCKET_TRANSCRIPTS, subtitlesKey))
            ? await ctx.storage.download(BUCKET_TRANSCRIPTS, subtitlesKey, join(tempDir, "subs.srt"))
            : undefined;
        const sourcePath = await ctx.storage.download(BUCKET_VIDEOS, sourceKey, join(tempDir, "source"));
        const render = buildRenderCommand(sourcePath, tempVideo, {
            clipStart: clip.start_s,
            clipEnd: clip.end_s,
            subtitlesPath,
            makeThumb: {
                outPath: tempThumb,
                atSec: (clip.start_s + clip.end_s) / 2,
            },
        });
        await runFFmpeg(render.args, ctx.logger);
        await ensureFileExists(tempVideo);
        await ensureFileExists(tempThumb);
        await uploadIfMissing(ctx, BUCKET_RENDERS, videoKey, tempVideo, "video/mp4");
        await uploadIfMissing(ctx, BUCKET_THUMBS, thumbKey, tempThumb, "image/jpeg");
        await ctx.supabase
            .from("clips")
            .update({
            status: "ready",
            storage_path: `${BUCKET_RENDERS}/${videoKey}`,
            thumb_path: `${BUCKET_THUMBS}/${thumbKey}`,
        })
            .eq("id", clipId);
        ctx.logger.info("pipeline_completed", {
            pipeline: PIPELINE,
            clipId,
            projectId,
            workspaceId,
            videoKey,
            thumbKey,
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
async function resolveSourceKey(ctx, workspaceId, projectId) {
    const prefix = `${workspaceId}/${projectId}/`;
    const objects = await ctx.storage.list(BUCKET_VIDEOS, prefix);
    const normalized = objects.map((entry) => (entry.startsWith(prefix) ? entry : `${prefix}${entry}`));
    const extensions = Object.keys(EXTENSION_MIME_MAP);
    const match = normalized.find((entry) => {
        const lower = entry.toLowerCase();
        return extensions.some((ext) => lower.endsWith(`source${ext}`));
    });
    if (!match) {
        throw new Error(`no source object found for project ${projectId}`);
    }
    return match;
}
async function fetchClip(ctx, clipId) {
    const response = await ctx.supabase
        .from("clips")
        .select("id,project_id,workspace_id,start_s,end_s,status,storage_path,thumb_path")
        .eq("id", clipId);
    const rows = response.data;
    return rows?.[0] ?? null;
}
async function fetchProject(ctx, projectId) {
    const response = await ctx.supabase.from("projects").select("id,workspace_id").eq("id", projectId);
    const rows = response.data;
    return rows?.[0] ?? null;
}
async function uploadIfMissing(ctx, bucket, key, localPath, contentType) {
    const exists = await ctx.storage.exists(bucket, key);
    if (exists) {
        return;
    }
    await ctx.storage.upload(bucket, key, localPath, contentType);
}
// Backwards compatibility for legacy imports.
export function pipelineClipRenderStub() {
    return "render";
}
async function ensureFileExists(path) {
    try {
        await fs.access(path);
    }
    catch {
        await fs.writeFile(path, '', 'utf8');
    }
}
