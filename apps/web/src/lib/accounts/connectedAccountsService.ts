import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ConnectedAccountDto,
  type ConnectedAccountPlatform,
  type CreateConnectedAccountInput,
  type UpdateConnectedAccountStatusInput,
  CreateConnectedAccountInput as CreateConnectedAccountInputSchema,
  UpdateConnectedAccountStatusInput as UpdateConnectedAccountStatusInputSchema,
} from "@cliply/shared/schemas/accounts";

import { logger } from "../logger";

/**
 * List connected accounts for a workspace
 */
export async function listConnectedAccounts(
  params: {
    workspaceId: string;
    platform?: ConnectedAccountPlatform;
  },
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto[]> {
  let query = ctx.supabase
    .from("connected_accounts")
    .select("*")
    .eq("workspace_id", params.workspaceId);

  if (params.platform) {
    query = query.eq("platform", params.platform);
  }

  const { data: accounts, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logger.error("connected_accounts_list_failed", {
      workspaceId: params.workspaceId,
      platform: params.platform,
      error: error.message,
    });
    throw new Error(`Failed to list connected accounts: ${error.message}`);
  }

  return (accounts || []).map((acc) => ({
    id: acc.id,
    workspace_id: acc.workspace_id,
    platform: acc.platform,
    provider: acc.provider,
    external_id: acc.external_id,
    display_name: acc.display_name ?? null,
    handle: acc.handle ?? null,
    status: acc.status ?? "active",
    scopes: acc.scopes ?? null,
    expires_at: acc.expires_at ?? null,
    created_at: acc.created_at,
    updated_at: acc.updated_at,
  }));
}

/**
 * Create or update a connected account
 * Uses upsert semantics by (workspace_id, platform, external_id)
 */
export async function createOrUpdateConnectedAccount(
  params: {
    workspaceId: string;
    userId: string;
  } & CreateConnectedAccountInput,
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto> {
  // Extract only the fields that belong to the schema
  const { workspaceId, userId, ...inputData } = params;
  const parsed = CreateConnectedAccountInputSchema.parse(inputData);

  // Check for existing account by (workspace_id, platform, external_id)
  const { data: existing, error: lookupError } = await ctx.supabase
    .from("connected_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("platform", parsed.platform)
    .eq("external_id", parsed.external_id)
    .maybeSingle();

  if (lookupError && lookupError.code !== "PGRST116") {
    logger.error("connected_accounts_lookup_failed", {
      workspaceId,
      platform: parsed.platform,
      error: lookupError.message,
    });
    throw new Error(`Failed to lookup account: ${lookupError.message}`);
  }

  const accountData: Record<string, unknown> = {
    workspace_id: workspaceId,
    user_id: userId,
    platform: parsed.platform,
    provider: parsed.provider,
    external_id: parsed.external_id,
    display_name: parsed.display_name ?? null,
    handle: parsed.handle ?? null,
    status: "active",
    scopes: parsed.scopes ?? null,
    expires_at: parsed.expires_at ?? null,
  };

  // Only update tokens if provided (for security)
  if (parsed.access_token) {
    accountData.access_token_encrypted_ref = parsed.access_token; // In real OAuth, this would be encrypted
  }
  if (parsed.refresh_token) {
    accountData.refresh_token_encrypted_ref = parsed.refresh_token; // In real OAuth, this would be encrypted
  }

  let result;
  if (existing) {
    // Update existing
    const { data: updated, error: updateError } = await ctx.supabase
      .from("connected_accounts")
      .update(accountData)
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError || !updated) {
      logger.error("connected_accounts_update_failed", {
        workspaceId,
        accountId: existing.id,
        error: updateError?.message,
      });
      throw new Error(`Failed to update account: ${updateError?.message ?? "unknown"}`);
    }

    result = updated;
  } else {
    // Create new
    const { data: created, error: createError } = await ctx.supabase
      .from("connected_accounts")
      .insert(accountData)
      .select()
      .single();

    if (createError || !created) {
      logger.error("connected_accounts_create_failed", {
        workspaceId,
        platform: parsed.platform,
        error: createError?.message,
      });
      throw new Error(`Failed to create account: ${createError?.message ?? "unknown"}`);
    }

    result = created;
  }

  logger.info("connected_account_upserted", {
    workspaceId,
    accountId: result.id,
    platform: parsed.platform,
    isNew: !existing,
  });

  return {
    id: result.id,
    workspace_id: result.workspace_id,
    platform: result.platform,
    provider: result.provider,
    external_id: result.external_id,
    display_name: result.display_name ?? null,
    handle: result.handle ?? null,
    status: result.status ?? "active",
    scopes: result.scopes ?? null,
    expires_at: result.expires_at ?? null,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

/**
 * Update connected account status
 */
export async function updateConnectedAccountStatus(
  params: {
    workspaceId: string;
    accountId: string;
  } & UpdateConnectedAccountStatusInput,
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Extract only the fields that belong to the schema
  const { workspaceId, accountId, ...inputData } = params;
  const parsed = UpdateConnectedAccountStatusInputSchema.parse(inputData);

  // Verify account belongs to workspace
  const { data: account, error: lookupError } = await ctx.supabase
    .from("connected_accounts")
    .select("id, workspace_id")
    .eq("id", accountId)
    .eq("workspace_id", workspaceId)
    .single();

  if (lookupError || !account) {
    logger.warn("connected_account_status_update_not_found", {
      workspaceId,
      accountId,
      error: lookupError?.message,
    });
    throw new Error("Connected account not found or does not belong to workspace");
  }

  const { error: updateError } = await ctx.supabase
    .from("connected_accounts")
    .update({ status: parsed.status })
    .eq("id", accountId);

  if (updateError) {
    logger.error("connected_account_status_update_failed", {
      workspaceId,
      accountId,
      error: updateError.message,
    });
    throw new Error(`Failed to update account status: ${updateError.message}`);
  }

  logger.info("connected_account_status_updated", {
    workspaceId,
    accountId,
    status: parsed.status,
  });
}

/**
 * Get connected accounts for publishing
 * Validates that requested accounts belong to workspace and platform
 */
export async function getConnectedAccountsForPublish(
  params: {
    workspaceId: string;
    platform: ConnectedAccountPlatform;
    connectedAccountIds?: string[];
  },
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto[]> {
  // Map platform to provider (for now, they're the same)
  const provider = params.platform;

  if (params.connectedAccountIds && params.connectedAccountIds.length > 0) {
    // Validate specific accounts
    const { data: accounts, error } = await ctx.supabase
      .from("connected_accounts")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("platform", params.platform)
      .in("id", params.connectedAccountIds)
      .eq("status", "active");

    if (error) {
      logger.error("connected_accounts_validate_failed", {
        workspaceId: params.workspaceId,
        platform: params.platform,
        error: error.message,
      });
      throw new Error(`Failed to validate accounts: ${error.message}`);
    }

    if (!accounts || accounts.length !== params.connectedAccountIds.length) {
      const foundIds = new Set(accounts?.map((a) => a.id) || []);
      const missingIds = params.connectedAccountIds.filter((id) => !foundIds.has(id));
      logger.warn("connected_accounts_validation_mismatch", {
        workspaceId: params.workspaceId,
        platform: params.platform,
        requestedIds: params.connectedAccountIds,
        missingIds,
      });
      throw new Error(
        `Some connected accounts not found or inactive: ${missingIds.join(", ")}`,
      );
    }

    return accounts.map((acc) => ({
      id: acc.id,
      workspace_id: acc.workspace_id,
      platform: acc.platform,
      provider: acc.provider,
      external_id: acc.external_id,
      display_name: acc.display_name ?? null,
      handle: acc.handle ?? null,
      status: acc.status ?? "active",
      scopes: acc.scopes ?? null,
      expires_at: acc.expires_at ?? null,
      created_at: acc.created_at,
      updated_at: acc.updated_at,
    }));
  } else {
    // Return all active accounts for platform
    const { data: accounts, error } = await ctx.supabase
      .from("connected_accounts")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("platform", params.platform)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("connected_accounts_list_for_publish_failed", {
        workspaceId: params.workspaceId,
        platform: params.platform,
        error: error.message,
      });
      throw new Error(`Failed to list accounts: ${error.message}`);
    }

    return (accounts || []).map((acc) => ({
      id: acc.id,
      workspace_id: acc.workspace_id,
      platform: acc.platform,
      provider: acc.provider,
      external_id: acc.external_id,
      display_name: acc.display_name ?? null,
      handle: acc.handle ?? null,
      status: acc.status ?? "active",
      scopes: acc.scopes ?? null,
      expires_at: acc.expires_at ?? null,
      created_at: acc.created_at,
      updated_at: acc.updated_at,
    }));
  }
}

/**
 * Get a single connected account by ID, validating it belongs to workspace
 */
export async function getConnectedAccountById(
  params: {
    workspaceId: string;
    accountId: string;
  },
  ctx: { supabase: SupabaseClient },
): Promise<ConnectedAccountDto | null> {
  const { data: account, error } = await ctx.supabase
    .from("connected_accounts")
    .select("*")
    .eq("id", params.accountId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("connected_account_get_failed", {
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      error: error.message,
    });
    throw new Error(`Failed to get connected account: ${error.message}`);
  }

  if (!account) {
    return null;
  }

  return {
    id: account.id,
    workspace_id: account.workspace_id,
    platform: account.platform,
    provider: account.provider,
    external_id: account.external_id,
    display_name: account.display_name ?? null,
    handle: account.handle ?? null,
    status: account.status ?? "active",
    scopes: account.scopes ?? null,
    expires_at: account.expires_at ?? null,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

