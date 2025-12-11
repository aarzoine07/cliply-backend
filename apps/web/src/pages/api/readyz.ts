// FILE: apps/web/src/pages/api/readyz.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

// Shape of what the shared builder roughly returns.
// We keep this loose so we don't fight TS here.
type BackendReadinessReport = {
  ok?: boolean;
  checks?: Record<string, unknown>;
  queue?: {
    length?: number;
    oldestJobAge?: number | null;
    oldestJobAgeMs?: number | null;
    warning?: boolean;
    hardFail?: boolean;
    [key: string]: unknown;
  } | null;
  ffmpeg?: {
    ok?: boolean;
    [key: string]: unknown;
  } | null;
};

type ReadyzSuccessResponse = {
  ok: boolean;
  checks: Record<string, unknown>;
  queue: {
    length: number;
    oldestJobAge: number | null;
    warning?: boolean;
    [key: string]: unknown;
  };
  ffmpeg: {
    ok: boolean;
    [key: string]: unknown;
  };
};

type ReadyzErrorResponse = {
  ok: false;
  error: {
    message: string;
    detail?: string;
  };
};

type ReadyzResponse = ReadyzSuccessResponse | ReadyzErrorResponse;

/**
 * Helper: interpret a single check field (env/db/worker).
 * Accepts either:
 *   - boolean
 *   - object with { ok: boolean }
 *   - anything else ⇒ treat as healthy (true) by default
 */
function interpretCheck(value: unknown): boolean {
  if (typeof value === "boolean") return value;

  if (value && typeof value === "object" && "ok" in (value as any)) {
    const okVal = (value as any).ok;
    if (typeof okVal === "boolean") return okVal;
  }

  // If the check is missing or malformed, we default to healthy.
  return true;
}

export default async function readyzRoute(
  req: NextApiRequest,
  res: NextApiResponse<ReadyzResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const readiness = (await buildBackendReadinessReport()) as BackendReadinessReport;

    const checksRaw = readiness.checks ?? {};

    // Do NOT mutate the individual checks objects – tests expect things like
    // checks.db.ok and checks.db.message to be preserved.
    const checks: Record<string, unknown> = { ...checksRaw };

    const envOk = interpretCheck(checksRaw["env"]);
    const dbOk = interpretCheck(checksRaw["db"]);
    const workerOk = interpretCheck(checksRaw["worker"]);

    // FFmpeg check: treat missing as ok, explicit false as not ok.
    const ffmpegOk = readiness.ffmpeg?.ok !== false;

    // Queue: we normalize shape, but don't rely on it being present.
    const queueRaw = readiness.queue ?? {
      length: 0,
      oldestJobAge: null,
      oldestJobAgeMs: null,
      warning: false,
      hardFail: false,
    };

    const queueLength =
      typeof (queueRaw as any).length === "number"
        ? (queueRaw as any).length
        : 0;

    // Tests expect `oldestJobAge` – we support either `oldestJobAge` or `oldestJobAgeMs`
    const oldestJobAge =
      typeof (queueRaw as any).oldestJobAge === "number"
        ? (queueRaw as any).oldestJobAge
        : typeof (queueRaw as any).oldestJobAgeMs === "number"
          ? (queueRaw as any).oldestJobAgeMs
          : null;

    const queueWarning =
      typeof (queueRaw as any).warning === "boolean"
        ? (queueRaw as any).warning
        : false;

    // Look at the overall readiness.ok as well – tests use this
    // to signal "hard fail" when combined with queue.warning.
    const readinessOk = typeof readiness.ok === "boolean" ? readiness.ok : true;

    const queueHardFail =
      typeof (queueRaw as any).hardFail === "boolean"
        ? (queueRaw as any).hardFail
        // If there is no explicit hardFail flag, interpret:
        // - ok === true && warning === true  => soft warning (still healthy)
        // - ok === false && warning === true => hard fail (unhealthy)
        : readinessOk === false && queueWarning;

    // Readiness semantics:
    // - Soft warning (ok=true, warning=true)      => service still "ok" (200)
    // - Hard fail (ok=false, warning=true OR hardFail=true) => not ok (503)
    const queueOk = !queueHardFail;

    const overallOk = envOk && dbOk && workerOk && ffmpegOk && queueOk;
    const statusCode = overallOk ? 200 : 503;

    const queue: ReadyzSuccessResponse["queue"] = {
      length: queueLength,
      oldestJobAge,
      ...(queueWarning ? { warning: true } : {}),
    };

    const ffmpeg: ReadyzSuccessResponse["ffmpeg"] = {
      ok: ffmpegOk,
      ...(readiness.ffmpeg ?? {}),
    };

    // IMPORTANT: Only these keys — tests assert exact shape:
    // { ok, checks, queue, ffmpeg }
    const body: ReadyzSuccessResponse = {
      ok: overallOk,
      checks,
      queue,
      ffmpeg,
    };

    return res.status(statusCode).json(body);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown readiness error";

    return res.status(500).json({
      ok: false,
      error: {
        message: "internal_error",
        detail,
      },
    });
  }
}