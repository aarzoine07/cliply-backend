import type { NextApiRequest, NextApiResponse } from 'next';
import { checkEnvForApi, checkSupabaseConnection } from '@cliply/shared/health/readyChecks.js';
import { getAdminClient } from '../../lib/supabase';

type ReadyzChecks = {
  env: boolean;
  db: boolean;
};

type ReadyzErrors = {
  env?: unknown;
  db?: unknown;
};

type ReadyzResponse = {
  ok: boolean;
  service: 'api';
  checks: ReadyzChecks;
  errors?: ReadyzErrors;
  ts: string;
};

export default async function readyzRoute(
  req: NextApiRequest,
  res: NextApiResponse<ReadyzResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  // ─────────────────────────────────────────────
  // 1. Environment check
  // ─────────────────────────────────────────────
  const envResult = checkEnvForApi();
  const envOk = !!envResult?.ok;

  // ─────────────────────────────────────────────
  // 2. DB connectivity check
  //    (Vitest will mock checkSupabaseConnection)
  // ─────────────────────────────────────────────
  let dbOk = true;
  let dbError: unknown;

  try {
    const admin = getAdminClient();
    const dbResult = await checkSupabaseConnection(admin as any);
    dbOk = !!dbResult?.ok;

    if (!dbOk) {
      dbError = dbResult?.error ?? dbResult;
    }
  } catch (err) {
    dbOk = false;
    dbError = err;
  }

  // ─────────────────────────────────────────────
  // 3. Aggregate status + response shape
  // ─────────────────────────────────────────────
  const ok = envOk && dbOk;

  const checks: ReadyzChecks = {
    env: envOk,
    db: dbOk,
  };

  const errors: ReadyzErrors = {};
  if (!envOk) {
    errors.env = envResult;
  }
  if (!dbOk && dbError) {
    errors.db = dbError;
  }

  const statusCode = ok ? 200 : 503;

  return res.status(statusCode).json({
    ok,
    service: 'api',
    checks,
    errors: Object.keys(errors).length ? errors : undefined,
    ts: new Date().toISOString(),
  });
}

