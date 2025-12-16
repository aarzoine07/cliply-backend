import type { NextApiRequest, NextApiResponse } from "next";

import { UpdateConnectedAccountStatusInput } from "@cliply/shared/schemas/accounts";

import { handler, ok, err } from "@/lib/http";
import { buildAuthContext, handleAuthError } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { getRlsClient } from "@/lib/supabase";
import * as connectedAccountsService from "@/lib/accounts/connectedAccountsService";

function normalizeStatusForSchema(status: unknown): unknown {
  if (typeof status !== "string") return status;
  if (status === "disabled") return "revoked";
  if (status === "enabled") return "active";
  return status;
}

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const workspaceId = (auth as any).workspaceId || (auth as any).workspace_id;

  if (!workspaceId) {
    res.status(400).json(err("invalid_request", "workspace required"));
    return;
  }

  // Prefer auth.supabase (test harness), fallback to token-based RLS client (prod path)
  const supabaseFromAuth = (auth as any).supabase;
  const accessToken =
    typeof (auth as any).accessToken === "string"
      ? (auth as any).accessToken
      : typeof (auth as any).access_token === "string"
        ? (auth as any).access_token
        : typeof (auth as any).session?.access_token === "string"
          ? (auth as any).session.access_token
          : typeof (auth as any).session?.accessToken === "string"
            ? (auth as any).session.accessToken
            : null;

  const supabase =
    supabaseFromAuth && typeof supabaseFromAuth.from === "function"
      ? supabaseFromAuth
      : accessToken
        ? getRlsClient(accessToken)
        : null;

  if (!supabase) {
    res.status(401).json(err("unauthorized", "Missing access token"));
    return;
  }

  const accountId = req.query.id as string;
  if (
    !accountId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      accountId,
    )
  ) {
    res.status(400).json(err("invalid_request", "Invalid account ID"));
    return;
  }

  let body: unknown = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json(err("invalid_request", "Invalid JSON payload"));
      return;
    }
  }

  // Normalize status from API semantics -> DB/schema semantics BEFORE validation
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    body = { ...b, status: normalizeStatusForSchema(b.status) };
  }

  const parsed = UpdateConnectedAccountStatusInput.safeParse(body);
  if (!parsed.success) {
    res
      .status(400)
      .json(err("invalid_request", "Invalid payload", parsed.error.flatten()));
    return;
  }

  try {
    await connectedAccountsService.updateConnectedAccountStatus(
      {
        workspaceId,
        accountId,
        ...parsed.data,
      },
      { supabase },
    );

    logger.info("account_status_updated", {
      workspaceId,
      accountId,
      status: parsed.data.status,
    });

    res.status(200).json(ok({ success: true }));
  } catch (error) {
    if ((error as Error)?.message?.includes("not found")) {
      res.status(404).json(err("not_found", "Connected account not found"));
      return;
    }

    logger.error("account_status_update_failed", {
      workspaceId,
      accountId,
      message: (error as Error)?.message ?? "unknown",
    });
    res.status(500).json(err("internal_error", "Failed to update account status"));
  }
});