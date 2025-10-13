import { spawn } from "node:child_process";

interface LoggerLike {
  info?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

export async function runFFmpeg(args: string[], logger?: LoggerLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      const line = chunk.trim();
      if (line) {
        logger?.info?.(line);
      }
    });

    child.once("error", (error) => {
      logger?.error?.("ffmpeg_spawn_error", {
        error: (error as Error)?.message ?? "spawn error",
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
