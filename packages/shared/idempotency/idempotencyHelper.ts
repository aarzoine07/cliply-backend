import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { logger } from "../logging/logger";

/**
 * Context for idempotency operations.
 */
export interface IdempotencyContext {
  supabaseAdminClient: SupabaseClient;
  workspaceId: string;
  userId: string;
  key: string; // Value from Idempotency-Key header
  endpoint: string; // e.g., "publish/youtube" or "billing/checkout"
}

/**
 * Idempotency record from the database.
 */
export interface IdempotencyRecord {
  key: string;
  user_id: string;
  status: "pending" | "completed" | "failed";
  request_hash: string | null;
  response_hash: string | null;
  created_at: string;
  expires_at: string | null;
}

/**
 * Handler function that performs the actual work.
 */
export type IdempotentHandler<TResponse> = () => Promise<TResponse>;

/**
 * Result of running an idempotent operation.
 */
export interface IdempotencyResult<TResponse> {
  reused: boolean; // true if response was reused from cache
  response: TResponse;
  storedResponse?: unknown; // Optional stored response data (if available)
}

/**
 * Compute a deterministic hash from a request body.
 * Uses stable JSON stringification to ensure consistent hashing.
 */
function computeRequestHash(requestBody: unknown): string {
  // Sort keys to ensure deterministic JSON stringification
  const normalized = JSON.stringify(requestBody, Object.keys(requestBody as Record<string, unknown>).sort());
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Create a composite idempotency key from workspace, endpoint, and header key.
 * This ensures keys are scoped to workspace and endpoint.
 */
function createCompositeKey(workspaceId: string, endpoint: string, headerKey: string): string {
  const composite = `${workspaceId}:${endpoint}:${headerKey}`;
  return createHash("sha256").update(composite).digest("hex");
}

/**
 * Run an operation with idempotency protection.
 * 
 * Behavior:
 * - If a completed record exists with matching request_hash, return cached response
 * - If a completed record exists with different request_hash, throw error (conflict)
 * - If a pending record exists, throw error (still processing)
 * - Otherwise, insert pending record, run handler, store response, mark completed
 * 
 * @param ctx Idempotency context (workspace, user, key, endpoint)
 * @param requestBody Request body to hash for conflict detection
 * @param handler Function that performs the actual work
 * @param options Optional configuration
 * @param options.storeResponseJson If true, store response JSON in response_hash (for small responses like checkout)
 * @returns Result with reused flag and response
 */
export async function runIdempotent<TResponse>(
  ctx: IdempotencyContext,
  requestBody: unknown,
  handler: IdempotentHandler<TResponse>,
  options?: { storeResponseJson?: boolean },
): Promise<IdempotencyResult<TResponse>> {
  const { supabaseAdminClient, workspaceId, userId, key, endpoint } = ctx;

  // Create composite key from workspace, endpoint, and header key
  const compositeKey = createCompositeKey(workspaceId, endpoint, key);
  const requestHash = computeRequestHash(requestBody);

  // Check for existing record
  const { data: existing, error: selectError } = await supabaseAdminClient
    .from("idempotency")
    .select("key, status, request_hash, response_hash")
    .eq("key", compositeKey)
    .maybeSingle();

  if (selectError && selectError.code !== "PGRST116") {
    // PGRST116 is "not found", which is fine
    logger.error("idempotency_check_failed", {
      workspaceId,
      endpoint,
      error: selectError.message,
    });
    throw new Error(`Failed to check idempotency: ${selectError.message}`);
  }

  // If record exists and is completed
  if (existing && existing.status === "completed") {
    // Check if request hash matches (same request)
    if (existing.request_hash === requestHash) {
      // Reuse existing response
      logger.info("workspace_idempotent_reuse", {
        workspaceId,
        endpoint,
        idempotencyKey: key,
        requestHash,
      });

      // Try to retrieve stored response from response_hash
      // If storeResponseJson was used, response_hash contains JSON; otherwise it's a hash
      let storedResponse: unknown = undefined;
      if (existing.response_hash) {
        try {
          // Try to parse as JSON (if storeResponseJson was used)
          storedResponse = JSON.parse(existing.response_hash);
        } catch {
          // Not JSON, it's a hash - endpoints must reconstruct
          storedResponse = undefined;
        }
      }

      return {
        reused: true,
        response: undefined as unknown as TResponse, // Endpoints must reconstruct
        storedResponse,
      };
    } else {
      // Same key, different body - conflict
      logger.warn("idempotency_conflict", {
        workspaceId,
        endpoint,
        idempotencyKey: key,
        existingHash: existing.request_hash,
        newHash: requestHash,
      });
      throw new Error(
        `Idempotency key conflict: same key used with different request body. Endpoint: ${endpoint}`,
      );
    }
  }

  // If record exists and is pending
  if (existing && existing.status === "pending") {
    logger.warn("idempotency_pending", {
      workspaceId,
      endpoint,
      idempotencyKey: key,
    });
    throw new Error(
      `Request is still processing. Endpoint: ${endpoint}. Please retry after a few seconds.`,
    );
  }

  // No existing record - insert pending record
  const { error: insertError } = await supabaseAdminClient
    .from("idempotency")
    .insert({
      key: compositeKey,
      user_id: userId,
      status: "pending",
      request_hash: requestHash,
      response_hash: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    })
    .select()
    .single();

  if (insertError) {
    // Handle race condition: another request might have inserted the same key
    // Check again to see if it's now completed or pending
    const { data: raceCheck } = await supabaseAdminClient
      .from("idempotency")
      .select("key, status, request_hash")
      .eq("key", compositeKey)
      .maybeSingle();

    if (raceCheck) {
      if (raceCheck.status === "completed" && raceCheck.request_hash === requestHash) {
        // Another request completed with same hash - reuse
        logger.info("workspace_idempotent_reuse", {
          workspaceId,
          endpoint,
          idempotencyKey: key,
          requestHash,
        });
        return {
          reused: true,
          response: undefined as unknown as TResponse, // Endpoints must reconstruct
        };
      } else if (raceCheck.status === "pending") {
        throw new Error(
          `Request is still processing. Endpoint: ${endpoint}. Please retry after a few seconds.`,
        );
      } else if (raceCheck.request_hash !== requestHash) {
        throw new Error(
          `Idempotency key conflict: same key used with different request body. Endpoint: ${endpoint}`,
        );
      }
    }

    logger.error("idempotency_insert_failed", {
      workspaceId,
      endpoint,
      error: insertError.message,
    });
    throw new Error(`Failed to create idempotency record: ${insertError.message}`);
  }

  // Run the actual handler
  let response: TResponse;
  let responseHash: string;
  try {
    response = await handler();

    // Compute response hash or store JSON based on options
    const responseJson = JSON.stringify(response);
    let responseHashValue: string;
    
    if (options?.storeResponseJson) {
      // Store JSON directly in response_hash (for small responses like checkout)
      // This is a workaround - in production you might want a separate response_json column
      responseHashValue = responseJson;
    } else {
      // Store hash for validation
      responseHashValue = createHash("sha256").update(responseJson).digest("hex");
    }

    // Mark as completed
    const { error: updateError } = await supabaseAdminClient
      .from("idempotency")
      .update({
        status: "completed",
        response_hash: responseHashValue,
      })
      .eq("key", compositeKey);

    if (updateError) {
      logger.error("idempotency_update_failed", {
        workspaceId,
        endpoint,
        error: updateError.message,
      });
      // Don't throw - the operation succeeded, just logging failed
    }

    return {
      reused: false,
      response,
    };
  } catch (error) {
    // Mark as failed
    await supabaseAdminClient
      .from("idempotency")
      .update({
        status: "failed",
      })
      .eq("key", compositeKey)
      .select()
      .single();

    // Re-throw the error
    throw error;
  }
}

/**
 * Extract Idempotency-Key header from request (case-insensitive).
 * Returns null if header is missing.
 */
export function extractIdempotencyKey(req: { headers?: Record<string, string | string[] | undefined> }): string | null {
  const headers = req.headers || {};
  
  // Check case-insensitive for Idempotency-Key header
  const headerKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === "idempotency-key",
  );
  
  if (!headerKey) {
    return null;
  }

  const value = headers[headerKey];
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  
  return value || null;
}

