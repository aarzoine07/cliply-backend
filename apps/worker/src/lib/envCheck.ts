import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

const execFileAsync = promisify(execFile);

export type WorkerEnvStatus = {
  ok: boolean;
  ffmpegOk: boolean;
  ytDlpOk: boolean;
  missingEnv: string[];
};

/**
 * Critical environment variables required for the worker to function.
 * Missing any of these will cause the worker to fail fast at startup.
 */
const REQUIRED_ENVS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Verifies the worker environment by checking:
 * - Presence of critical environment variables
 * - Availability of ffmpeg binary
 * - Availability of yt-dlp binary
 *
 * @returns Status object indicating what's available and what's missing
 */
export async function verifyWorkerEnvironment(): Promise<WorkerEnvStatus> {
  const env = getEnv();

  // Check for missing required environment variables
  const missingEnv: string[] = [];
  for (const key of REQUIRED_ENVS) {
    if (!env[key]) {
      missingEnv.push(key);
    }
  }

  // Check ffmpeg availability
  let ffmpegOk = false;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    ffmpegOk = true;
  } catch (error) {
    // ENOENT means binary not found, other errors mean it exists but failed
    const isNotFound = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!isNotFound) {
      // Binary exists but command failed - still mark as available
      ffmpegOk = true;
    }
  }

  // Check yt-dlp availability
  let ytDlpOk = false;
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    ytDlpOk = true;
  } catch (error) {
    // ENOENT means binary not found, other errors mean it exists but failed
    const isNotFound = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!isNotFound) {
      // Binary exists but command failed - still mark as available
      ytDlpOk = true;
    }
  }

  // Overall status: ok only if all critical checks pass
  // Missing binaries are warnings but don't fail if env vars are present
  // (We'll let the actual job handlers fail if they need the binaries)
  const ok = missingEnv.length === 0;

  const status: WorkerEnvStatus = {
    ok,
    ffmpegOk,
    ytDlpOk,
    missingEnv,
  };

  if (ok && ffmpegOk && ytDlpOk) {
    logger.info("worker_env_ok", {
      service: "worker",
      ffmpegOk: true,
      ytDlpOk: true,
    });
  } else {
    logger.error("worker_env_problem", {
      service: "worker",
      ...status,
    });
  }

  return status;
}

