import { ClipApproveInput } from "@cliply/shared/schemas";
import type { NextApiRequest, NextApiResponse } from "next";

import { requireUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { err, handler, ok } from "@/lib/http";
import { keyFromRequest, withIdempotency } from "@/lib/idempotency";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase";

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info("clip_approve_start", { method: req.method ?? "GET" });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  const auth = requireUser(req);
  const { userId } = auth;

  const rate = await checkRateLimit(userId, "clips:approve");
  if (!rate.allowed) {
    res.status(429).json(err("too_many_requests", "Rate limited"));
    return;
  }

  const idParam = (req.query?.id ?? "") as string | string[];
  const clipId = Array.isArray(idParam) ? idParam[0] : idParam;

  if (!clipId) {
    res.status(400).json(err("invalid_request", "missing id"));
    return;
  }

  const parsed = ClipApproveInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err("invalid_request", "Invalid payload", parsed.error.flatten()));
    return;
  }

  const admin = getAdminClient();
  const idempotencyKey = keyFromRequest({
    method: req.method,
    url: `/api/clips/${clipId}/approve`,
    body: parsed.data,
  });

  const result = await withIdempotency(idempotencyKey, async () => {
    const clip = await admin
      .from("clips")
      .select("id,status,workspace_id")
      .eq("id", clipId)
      .maybeSingle();
    if (clip.error) {
      throw new HttpError(500, "Failed to fetch clip", "clip_fetch_failed", clip.error.message);
    }
    if (!clip.data) {
      throw new HttpError(404, "Clip not found", "clip_not_found");
    }

    const alreadyApproved = clip.data.status === "approved";

    if (!alreadyApproved) {
      const update = await admin.from("clips").update({ status: "approved" }).eq("id", clipId);
      if (update.error) {
        throw new HttpError(
          500,
          "Failed to approve clip",
          "clip_update_failed",
          update.error.message,
        );
      }

      const jobInsert = await admin.from("jobs").insert({
        workspace_id: clip.data.workspace_id,
        kind: "CLIP_RENDER",
        status: "queued",
        payload: { clipId },
      });

      if (jobInsert.error) {
        throw new HttpError(
          500,
          "Failed to enqueue render job",
          "job_insert_failed",
          jobInsert.error.message,
        );
      }
    }

    return { clipId };
  });

  logger.info("clip_approve_success", {
    userId,
    clipId,
    idempotent: !result.fresh,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  const payload = result.fresh ? result.value : { clipId };
  res.status(200).json(ok({ ...payload, idempotent: !result.fresh }));
});
