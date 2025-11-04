import { HttpError } from './errors';
import { getRlsClient } from "./supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    throw new HttpError(400, 'invalid authorization header', 'invalid_header');
  }
  return token;
}

function ensureUuid(value: string, headerName: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid ' + headerName, 'invalid_header');
  }
  return value;
}

export type AuthContext = {
  userId: string;
  workspaceId?: string | null;
  accessToken?: string | null;
  supabase: SupabaseClient;
};

export function requireUser(req?: { headers?: HeadersInput }): AuthContext {
  const normalized = normalizeHeaders(req?.headers);

  const userHeader = normalized['x-debug-user'];
  if (!userHeader) {
    throw new HttpError(401, 'missing user', 'missing_user');
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
