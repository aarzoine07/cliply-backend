/**
 * FFmpeg safety wrapper with timeout, duration limits, and structured error handling.
 * 
 * This wrapper provides:
 * - Timeout enforcement (kills ffmpeg if it runs too long)
 * - Duration validation (rejects videos that are too long)
 * - Structured error results (no thrown errors, returns result objects)
 * - Safe stderr logging (no secrets in logs)
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { LoggerLike } from "../pipelines/types";

export interface FfmpegOptions {
  /** Local file path for input video */
  inputPath: string;
  /** Local file path for output video */
  outputPath: string;
  /** Additional FFmpeg command-line arguments */
  args: string[];
  /** Maximum allowed duration in seconds (optional, enforced if provided) */
  maxDurationSeconds?: number;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Logger for structured logging */
  logger?: LoggerLike;
}

export type FfmpegResult =
  | {
      ok: true;
      durationSeconds?: number;
      stdout?: string;
      stderrSummary?: string;
    }
  | {
      ok: false;
      kind: "TIMEOUT" | "EXIT_CODE" | "SPAWN_ERROR";
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stderrSummary?: string;
    };

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Safely summarizes stderr output, removing potentially sensitive information.
 */
function summarizeStderr(stderr: string, maxLines = 10): string {
  const lines = stderr.split("\n").filter((line) => line.trim().length > 0);
  const tail = lines.slice(-maxLines).join("\n");
  
  // Remove any lines that might contain file paths or sensitive data
  // Keep only error messages and status lines
  const safeLines = tail
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase();
      // Filter out lines that look like they contain full paths or tokens
      return !lower.includes("password") && !lower.includes("token") && !lower.includes("key");
    })
    .join("\n");
  
  return safeLines.slice(0, 500); // Limit total length
}

/**
 * Extracts duration from FFmpeg stderr output if available.
 * FFmpeg outputs duration in format: "Duration: HH:MM:SS.mm"
 */
function extractDurationFromStderr(stderr: string): number | undefined {
  const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (durationMatch) {
    const hours = parseInt(durationMatch[1] ?? "0", 10);
    const minutes = parseInt(durationMatch[2] ?? "0", 10);
    const seconds = parseInt(durationMatch[3] ?? "0", 10);
    const centiseconds = parseInt(durationMatch[4] ?? "0", 10);
    return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
  }
  return undefined;
}

/**
 * Runs FFmpeg with safety constraints: timeout, duration limits, and structured error handling.
 * 
 * @param options FFmpeg execution options
 * @returns Structured result object (never throws)
 */
export async function runFfmpegSafely(options: FfmpegOptions): Promise<FfmpegResult> {
  const {
    inputPath,
    outputPath,
    args,
    maxDurationSeconds,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger,
  } = options;

  return new Promise<FfmpegResult>((resolve) => {
    let stderr = "";
    let stdout = "";
    let timeoutHandle: NodeJS.Timeout | null = null;
    let processKilled = false;

    // Build full command arguments
    const fullArgs = [...args];

    // Spawn FFmpeg process
    let child: ChildProcess;
    try {
      child = spawn("ffmpeg", fullArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      logger?.error("ffmpeg_spawn_error", {
        error: error instanceof Error ? error.message : String(error),
        inputPath,
        outputPath,
      });
      return resolve({
        ok: false,
        kind: "SPAWN_ERROR",
        stderrSummary: error instanceof Error ? error.message : String(error),
      });
    }

    // Set up timeout
    timeoutHandle = setTimeout(() => {
      if (!processKilled && child && !child.killed) {
        processKilled = true;
        child.kill("SIGKILL");
        logger?.error("ffmpeg_timeout", {
          timeoutMs,
          inputPath,
          outputPath,
        });
        resolve({
          ok: false,
          kind: "TIMEOUT",
          signal: "SIGKILL",
          stderrSummary: summarizeStderr(stderr),
        });
      }
    }, timeoutMs);

    // Collect stderr
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      // Log progress lines (but not all of them to avoid spam)
      const line = chunk.trim();
      if (line && (line.includes("time=") || line.includes("Duration:"))) {
        logger?.info("ffmpeg_progress", { line: line.slice(0, 100) });
      }
    });

    // Collect stdout
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    // Handle spawn errors
    child.once("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      logger?.error("ffmpeg_spawn_error", {
        error: error instanceof Error ? error.message : String(error),
        inputPath,
        outputPath,
      });
      resolve({
        ok: false,
        kind: "SPAWN_ERROR",
        stderrSummary: error instanceof Error ? error.message : String(error),
      });
    });

    // Handle process completion
    child.once("close", (code, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // If we already resolved due to timeout, don't resolve again
      if (processKilled) {
        return;
      }

      if (code === 0) {
        // Success - check duration if needed
        const duration = extractDurationFromStderr(stderr);
        
        if (maxDurationSeconds !== undefined && duration !== undefined && duration > maxDurationSeconds) {
          logger?.error("ffmpeg_duration_exceeded", {
            durationSeconds: duration,
            maxDurationSeconds,
            inputPath,
            outputPath,
          });
          resolve({
            ok: false,
            kind: "EXIT_CODE",
            exitCode: 1,
            stderrSummary: `Video duration ${duration}s exceeds maximum ${maxDurationSeconds}s`,
          });
          return;
        }

        logger?.info("ffmpeg_completed", {
          inputPath,
          outputPath,
          durationSeconds: duration,
        });
        resolve({
          ok: true,
          durationSeconds: duration,
          stdout: stdout.slice(0, 1000), // Limit stdout size
          stderrSummary: summarizeStderr(stderr),
        });
      } else {
        // Non-zero exit code
        logger?.error("ffmpeg_failed", {
          exitCode: code,
          signal,
          inputPath,
          outputPath,
          stderrSummary: summarizeStderr(stderr),
        });
        resolve({
          ok: false,
          kind: "EXIT_CODE",
          exitCode: code ?? null,
          signal: signal ?? undefined,
          stderrSummary: summarizeStderr(stderr),
        });
      }
    });
  });
}

