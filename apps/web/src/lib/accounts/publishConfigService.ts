// C1: finish publish config service – do not redo existing behaviour, only fill gaps
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type PublishConfigDto,
  type UpdatePublishConfigInput,
  type ConnectedAccountPlatform,
} from "@cliply/shared/schemas/accounts";

import { logger } from "../logger";

/**
 * Get publish config for a workspace and platform
 * Returns default config if none exists
 */
export async function getPublishConfig(
  params: {
    workspaceId: string;
    platform: ConnectedAccountPlatform;
  },
  ctx: { supabase: SupabaseClient },
): Promise<PublishConfigDto> {
  const { data: config, error } = await ctx.supabase
    .from("publish_config")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("platform", params.platform)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    logger.error("publish_config_get_failed", {
      workspaceId: params.workspaceId,
      platform: params.platform,
      error: error.message,
    });
    throw new Error(`Failed to get publish config: ${error.message}`);
  }

  // Return default config if none exists
  if (!config) {
    return {
      id: "", // Will be generated on first update
      workspace_id: params.workspaceId,
      platform: params.platform,
      enabled: true,
      default_visibility: "public",
      default_connected_account_ids: [],
      title_template: null,
      description_template: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  return {
    id: config.id,
    workspace_id: config.workspace_id,
    platform: config.platform,
    enabled: config.enabled ?? true,
    default_visibility: config.default_visibility ?? "public",
    default_connected_account_ids: config.default_connected_account_ids ?? [],
    title_template: config.title_template ?? null,
    description_template: config.description_template ?? null,
    created_at: config.created_at,
    updated_at: config.updated_at,
  };
}

/**
 * Update publish config for a workspace and platform
 * Creates config if it doesn't exist
 */
export async function updatePublishConfig(
  params: {
    workspaceId: string;
    platform: ConnectedAccountPlatform;
  } & UpdatePublishConfigInput,
  ctx: { supabase: SupabaseClient },
): Promise<PublishConfigDto> {
  // Check if config exists
  const { data: existing, error: lookupError } = await ctx.supabase
    .from("publish_config")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("platform", params.platform)
    .maybeSingle();

  if (lookupError && lookupError.code !== "PGRST116") {
    logger.error("publish_config_lookup_failed", {
      workspaceId: params.workspaceId,
      platform: params.platform,
      error: lookupError.message,
    });
    throw new Error(`Failed to lookup config: ${lookupError.message}`);
  }

  const updateData: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    platform: params.platform,
    updated_at: new Date().toISOString(),
  };

  if (params.enabled !== undefined) {
    updateData.enabled = params.enabled;
  }
  if (params.default_visibility !== undefined) {
    updateData.default_visibility = params.default_visibility;
  }
  if (params.default_connected_account_ids !== undefined) {
    updateData.default_connected_account_ids = params.default_connected_account_ids;
  }
  if (params.title_template !== undefined) {
    updateData.title_template = params.title_template;
  }
  if (params.description_template !== undefined) {
    updateData.description_template = params.description_template;
  }

  let result;
  if (existing) {
    // Update existing
    const { data: updated, error: updateError } = await ctx.supabase
      .from("publish_config")
      .update(updateData)
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError || !updated) {
      logger.error("publish_config_update_failed", {
        workspaceId: params.workspaceId,
        platform: params.platform,
        error: updateError?.message,
      });
      throw new Error(`Failed to update config: ${updateError?.message ?? "unknown"}`);
    }

    result = updated;
  } else {
    // Create new with defaults
    const insertData = {
      ...updateData,
      enabled: params.enabled ?? true,
      default_visibility: params.default_visibility ?? "public",
      default_connected_account_ids: params.default_connected_account_ids ?? [],
      title_template: params.title_template ?? null,
      description_template: params.description_template ?? null,
    };

    const { data: created, error: createError } = await ctx.supabase
      .from("publish_config")
      .insert(insertData)
      .select()
      .single();

    if (createError || !created) {
      logger.error("publish_config_create_failed", {
        workspaceId: params.workspaceId,
        platform: params.platform,
        error: createError?.message,
      });
      throw new Error(`Failed to create config: ${createError?.message ?? "unknown"}`);
    }

    result = created;
  }

  logger.info("publish_config_upserted", {
    workspaceId: params.workspaceId,
    platform: params.platform,
    isNew: !existing,
  });

  return {
    id: result.id,
    workspace_id: result.workspace_id,
    platform: result.platform,
    enabled: result.enabled ?? true,
    default_visibility: result.default_visibility ?? "public",
    default_connected_account_ids: result.default_connected_account_ids ?? [],
    title_template: result.title_template ?? null,
    description_template: result.description_template ?? null,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

