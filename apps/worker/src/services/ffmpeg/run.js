import { spawn } from "node:child_process";
export async function runFFmpeg(args, logger) {
    await new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk) => {
            stderr += chunk;
            const line = chunk.trim();
            if (line) {
                logger?.info?.(line);
            }
        });
        child.once("error", (error) => {
            logger?.error?.("ffmpeg_spawn_error", {
                error: error?.message ?? "spawn error",
            });
            reject(error);
        });
        child.once("close", (code) => {
            if (code === 0) {
                logger?.info?.("ffmpeg_completed", { args });
                resolve();
                return;
            }
            const tail = stderr.split("\n").slice(-10).join("\n");
            logger?.error?.("ffmpeg_failed", { code, stderr: tail });
            reject(new Error(`ffmpeg failed with code ${code}: ${tail}`));
        });
    });
}
