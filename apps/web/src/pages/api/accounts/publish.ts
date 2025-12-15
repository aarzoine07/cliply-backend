// C1: finish publish config API – do not redo existing behaviour, only fill gaps
import type { NextApiRequest, NextApiResponse } from "next";

import { ConnectedAccountPlatform, UpdatePublishConfigInput } from "@cliply/shared/schemas/accounts";

import { handler, ok, err } from "@/lib/http";
import { buildAuthContext, handleAuthError } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { getRlsClient } from "@/lib/supabase";
import * as connectedAccountsService from "@/lib/accounts/connectedAccountsService";
import * as publishConfigService from "@/lib/accounts/publishConfigService";

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  let auth;
  try {
    auth = await buildAuthContext(req as any);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const workspaceId = (auth as any).workspaceId || (auth as any).workspace_id;

  if (!workspaceId) {
    res.status(400).json(err("invalid_request", "workspace required"));
    return;
  }

  // T2: Surface table access MUST be via RLS client (no service-role fallback).
  const accessToken =
    typeof (auth as any).accessToken === "string"
      ? (auth as any).accessToken
      : typeof (auth as any).access_token === "string"
        ? (auth as any).access_token
        : null;

  if (!accessToken) {
    res.status(401).json(err("unauthorized", "Missing access token"));
    return;
  }

  const supabase = getRlsClient(accessToken);

  // Default to YouTube for V1
  const platform = (req.query.platform as ConnectedAccountPlatform | undefined) ?? "youtube";

  if (!ConnectedAccountPlatform.safeParse(platform).success) {
    res.status(400).json(err("invalid_request", "Invalid platform"));
    return;
  }

  if (req.method === "GET") {
    try {
      const accounts = await connectedAccountsService.listConnectedAccounts(
        { workspaceId, platform },
        { supabase },
      );

      const publishConfig = await publishConfigService.getPublishConfig(
        { workspaceId, platform },
        { supabase },
      );

      logger.info("publish_config_fetched", {
        workspaceId,
        platform,
        accountCount: accounts.length,
      });

      res.status(200).json(
        ok({
          connectedAccounts: accounts,
          publishConfig,
        }),
      );
    } catch (error) {
      logger.error("publish_config_get_failed", {
        workspaceId,
        platform,
        message: (error as Error)?.message ?? "unknown",
      });
      res.status(500).json(err("internal_error", "Failed to fetch publish config"));
    }
    return;
  }

  if (req.method === "PATCH") {
    let body: unknown = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err("invalid_request", "Invalid JSON payload"));
        return;
      }
    }

    const parsed = UpdatePublishConfigInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err("invalid_request", "Invalid payload", parsed.error.flatten()));
      return;
    }

    try {
      if (parsed.data.default_connected_account_ids && parsed.data.default_connected_account_ids.length > 0) {
        const validAccounts = await connectedAccountsService.getConnectedAccountsForPublish(
          {
            workspaceId,
            platform,
            connectedAccountIds: parsed.data.default_connected_account_ids,
          },
          { supabase },
        );

        if (validAccounts.length !== parsed.data.default_connected_account_ids.length) {
          res
            .status(400)
            .json(
              err(
                "invalid_request",
                "Some connected account IDs are invalid or do not belong to this workspace/platform",
              ),
            );
          return;
        }
      }

      const updatedConfig = await publishConfigService.updatePublishConfig(
        { workspaceId, platform, ...parsed.data },
        { supabase },
      );

      logger.info("publish_config_updated", {
        workspaceId,
        platform,
        configId: updatedConfig.id,
      });

      res.status(200).json(ok(updatedConfig));
    } catch (error) {
      logger.error("publish_config_update_failed", {
        workspaceId,
        platform,
        message: (error as Error)?.message ?? "unknown",
      });
      res.status(500).json(err("internal_error", "Failed to update publish config"));
    }
    return;
  }

  res.setHeader("Allow", "GET, PATCH");
  res.status(405).json(err("method_not_allowed", "Method not allowed"));
});