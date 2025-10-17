import crypto from "crypto";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@cliply/shared/env";
import type { JobKind, JobPayload, JobRow } from "@cliply/shared/types/supabase.jobs";

export interface EnqueueParams {
  workspaceId: string;
  kind: JobKind;
  payload: JobPayload;
  priority?: number;
  runAt?: string;
  dedupeKey?: string;
}

export interface EnqueueResponse {
  ok: boolean;
  jobId?: string;
  error?: string;
}

const SERVICE_ROUTE = "jobs/enqueue";

type IdempotencyResponseRow = {
  response: EnqueueResponse | null;
};

let cachedClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}

function clampPriority(priority: number | undefined): number {
  const defaultPriority = 5;
  if (priority === undefined) return defaultPriority;
  if (!Number.isFinite(priority)) return defaultPriority;
  const normalized = Math.trunc(priority);
  return Math.min(9, Math.max(1, normalized));
}

function normalizeRunAt(runAt?: string): { ok: true; value: string } | { ok: false; error: string } {
  if (!runAt) {
    return { ok: true, value: new Date().toISOString() };
  }

  const parsed = new Date(runAt);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "Invalid runAt value provided" };
  }

  return { ok: true, value: parsed.toISOString() };
}

function stablePayloadString(payload: JobPayload): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(sortKeys);
    }
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortKeys((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  };

  return JSON.stringify(sortKeys(payload));
}

function buildHash(kind: JobKind, payload: JobPayload, runAt: string, dedupeKey?: string): string {
  const canonical = `${kind}|${dedupeKey ?? stablePayloadString(payload)}|${runAt}`;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function isEnqueueResponse(value: unknown): value is EnqueueResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EnqueueResponse>;
  if (typeof candidate.ok !== "boolean") return false;
  if (candidate.ok) {
    return typeof candidate.jobId === "string" && candidate.jobId.length > 0;
  }
  return typeof candidate.error === "string" && candidate.error.length > 0;
}

async function fetchIdempotentResponse(
  supabase: SupabaseClient,
  workspaceId: string,
  keyHash: string,
): Promise<{ error?: PostgrestError; response?: EnqueueResponse }> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("response")
    .eq("workspace_id", workspaceId)
    .eq("route", SERVICE_ROUTE)
    .eq("key_hash", keyHash)
    .maybeSingle<IdempotencyResponseRow>();

  if (error) {
    return { error };
  }

  const stored = data?.response;
  if (stored && isEnqueueResponse(stored)) {
    return { response: stored };
  }

  return {};
}

export async function enqueueJob(params: EnqueueParams): Promise<EnqueueResponse> {
  const supabase = getServiceClient();
  const priority = clampPriority(params.priority);
  const runAtResult = normalizeRunAt(params.runAt);
  if (!runAtResult.ok) {
    return { ok: false, error: runAtResult.error };
  }

  const runAt = runAtResult.value;
  const keyHash = buildHash(params.kind, params.payload, runAt, params.dedupeKey);

  const existing = await fetchIdempotentResponse(supabase, params.workspaceId, keyHash);
  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }
  if (existing.response) {
    return existing.response;
  }

  const { data: job, error: insertError } = await supabase
    .from("jobs")
    .insert({
      workspace_id: params.workspaceId,
      kind: params.kind,
      payload: params.payload,
      priority,
      run_at: runAt,
    })
    .select()
    .single<JobRow>();

  if (insertError || !job) {
    return { ok: false, error: insertError?.message ?? "Failed to insert job" };
  }

  const response: EnqueueResponse = { ok: true, jobId: job.id };

  const { error: idempotencyError } = await supabase.from("idempotency_keys").insert({
    workspace_id: params.workspaceId,
    route: SERVICE_ROUTE,
    key_hash: keyHash,
    response,
  });

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      const retry = await fetchIdempotentResponse(supabase, params.workspaceId, keyHash);
      if (!retry.error && retry.response) {
        return retry.response;
      }
    }
  }

  return response;
}
