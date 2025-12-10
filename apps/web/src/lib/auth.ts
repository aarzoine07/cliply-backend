import { HttpError } from './errors';
import { getRlsClient } from "./supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Relaxed UUID check: enforce shape + hex, but do not enforce version/variant.
// This matches the shared auth context pattern.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HeaderValue = string | string[] | undefined;
type HeaderRecord = Record<string, HeaderValue>;
type HeadersInput = HeaderRecord | Headers;

type NormalizedHeaders = Record<string, string>;

function isHeaders(value: unknown): value is Headers {
  return typeof Headers !== 'undefined' && value instanceof Headers;
}

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const trimmed = entry.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function normalizeHeaders(input?: HeadersInput): NormalizedHeaders {
  if (!input) return {};

  const normalized: NormalizedHeaders = {};

  if (isHeaders(input)) {
    input.forEach((value, key) => {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[key.toLowerCase()] = trimmed;
      }
    });
    return normalized;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalizedValue = firstHeaderValue(value);
    if (normalizedValue) {
      normalized[key.toLowerCase()] = normalizedValue;
    }
  }

  return normalized;
}

function parseAuthorization(value?: string): string | undefined {
  if (!value) return undefined;
  const [scheme, token] = value.split(/\s+/, 2);
  if (!token || scheme.toLowerCase() !== 'bearer') {
    throw new HttpError(400, 'invalid authorization header', undefined, 'invalid_header');
  }
  return token;
}

function ensureUuid(value: string, headerName: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid ' + headerName, undefined, 'invalid_header');
  }
  return value;
}

export type AuthContext = {
  userId: string;
  workspaceId?: string | null;
  accessToken?: string | null;
  supabase: SupabaseClient;
};

/**
 * @deprecated Use `buildAuthContext` from `@/lib/auth/context` instead.
 * This function only supports debug headers and will be removed in a future version.
 */
export function requireUser(req?: { headers?: HeadersInput }): AuthContext {
  // In production, block debug headers
  if (process.env.NODE_ENV === 'production') {
    throw new HttpError(401, 'Debug headers are not allowed in production', undefined, 'production_only');
  }

  const normalized = normalizeHeaders(req?.headers);

  const userHeader = normalized['x-debug-user'];
  if (!userHeader) {
    throw new HttpError(401, 'missing user', undefined, 'missing_user');
  }

  const userId = ensureUuid(userHeader, 'x-debug-user');

  const workspaceHeader = normalized['x-debug-workspace'];
  const workspaceId = workspaceHeader ? ensureUuid(workspaceHeader, 'x-debug-workspace') : undefined;

  const accessToken = parseAuthorization(normalized['authorization']);
  const supabase = getRlsClient(accessToken);

  const context: AuthContext = {
    userId,
    supabase,
  };

  if (workspaceId !== undefined) {
    context.workspaceId = workspaceId;
  }

  if (accessToken !== undefined) {
    context.accessToken = accessToken;
  }

  return context;
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const headersRecord: HeaderRecord = {};
  req.headers.forEach((value, key) => {
    headersRecord[key] = value;
  });

  return requireUser({ headers: headersRecord });
}
