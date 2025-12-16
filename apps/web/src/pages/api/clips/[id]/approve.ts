import { ClipApproveInput } from "@cliply/shared/schemas";
import { ERROR_CODES } from "@cliply/shared/errorCodes";
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
  const { userId, supabase } = auth;

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
    // IMPORTANT (T2): Use RLS client for surface table access.
    const clip = await supabase
      .from("clips")
      .select("id,status,workspace_id")
      .eq("id", clipId)
      .maybeSingle();

    if (clip.error) {
      throw new HttpError(500, "Failed to fetch clip", { details: clip.error.message }, "clip_fetch_failed");
    }
    if (!clip.data) {
      // If RLS blocks access, this will also appear as "not found" (no row returned).
      throw new HttpError(404, "Clip not found", undefined, "clip_not_found");
    }

    if (clip.data.status === "published") {
      throw new HttpError(400, "Cannot modify a published clip", undefined, ERROR_CODES.clip_already_published);
    }

    const alreadyApproved = clip.data.status === "approved";

    if (!alreadyApproved) {
      const update = await supabase
        .from("clips")
        .update({ status: "approved" })
        .eq("id", clipId)
        .select("id")
        .maybeSingle();

      if (update.error) {
        throw new HttpError(
          500,
          "Failed to approve clip",
          { details: update.error.message },
          "clip_update_failed",
        );
      }
      if (!update.data) {
        throw new HttpError(404, "Clip not found", undefined, "clip_not_found");
      }

      // Internal table insert can stay service-role.
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
          { details: jobInsert.error.message },
          "job_insert_failed",
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
