import { z } from "zod";

/**
 * Platform types for connected accounts
 */
export const ConnectedAccountPlatform = z.enum(["youtube", "tiktok", "instagram", "twitter", "facebook"]);
export type ConnectedAccountPlatform = z.infer<typeof ConnectedAccountPlatform>;

/**
 * Status of a connected account
 * Updated in migration 20251201030000_connected_accounts_platform_status.sql
 */
export const ConnectedAccountStatus = z.enum(["active", "revoked", "error"]);
export type ConnectedAccountStatus = z.infer<typeof ConnectedAccountStatus>;

/**
 * Connected account DTO (for API responses, excludes sensitive tokens)
 */
export const ConnectedAccountDto = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  platform: ConnectedAccountPlatform,
  provider: z.string(),
  external_id: z.string(),
  display_name: z.string().nullable(),
  handle: z.string().nullable(),
  status: ConnectedAccountStatus,
  scopes: z.array(z.string()).nullable(),
  expires_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type ConnectedAccountDto = z.infer<typeof ConnectedAccountDto>;

/**
 * Create or update connected account input
 */
export const CreateConnectedAccountInput = z.object({
  platform: ConnectedAccountPlatform,
  provider: z.string().min(1),
  external_id: z.string().min(1),
  display_name: z.string().optional(),
  handle: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
}).strict();
export type CreateConnectedAccountInput = z.infer<typeof CreateConnectedAccountInput>;

/**
 * Update connected account status input
 */
export const UpdateConnectedAccountStatusInput = z.object({
  status: ConnectedAccountStatus,
}).strict();
export type UpdateConnectedAccountStatusInput = z.infer<typeof UpdateConnectedAccountStatusInput>;

/**
 * C1: Publish Config schemas for workspace-level publishing preferences
 */

/**
 * Publish config DTO (for API responses)
 */
export const PublishConfigDto = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  platform: ConnectedAccountPlatform,
  enabled: z.boolean(),
  default_visibility: z.enum(['public', 'unlisted', 'private']),
  default_connected_account_ids: z.array(z.string().uuid()),
  title_template: z.string().nullable(),
  description_template: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type PublishConfigDto = z.infer<typeof PublishConfigDto>;

/**
 * Update publish config input
 */
export const UpdatePublishConfigInput = z.object({
  enabled: z.boolean().optional(),
  default_visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  default_connected_account_ids: z.array(z.string().uuid()).optional(),
  title_template: z.string().nullable().optional(),
  description_template: z.string().nullable().optional(),
}).strict();
export type UpdatePublishConfigInput = z.infer<typeof UpdatePublishConfigInput>;

