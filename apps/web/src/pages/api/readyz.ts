// FILE: apps/web/src/pages/api/readyz.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { buildBackendReadinessReport } from '@cliply/shared/readiness/backendReadiness';

type ReadyzSuccessResponse = {
  ok: boolean;
  checks: unknown;
  queue: unknown;
  ffmpeg: unknown;
};

type ReadyzErrorResponse = {
  ok: false;
  error: {
    message: string;
    detail?: string;
  };
};

type ReadyzResponse = ReadyzSuccessResponse | ReadyzErrorResponse;

export default async function readyzRoute(
  req: NextApiRequest,
  res: NextApiResponse<ReadyzResponse>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Build the full backend readiness report (engine + env + db + queue + ffmpeg)
    const readiness: any = await buildBackendReadinessReport();

    // Status code follows readiness.ok
    const statusCode = readiness?.ok ? 200 : 503;

    // Route-level contract:
    // - Only expose: ok, checks, queue, ffmpeg
    // - No timestamp on this endpoint (admin variant can add that)
    return res.status(statusCode).json({
      ok: !!readiness?.ok,
      checks: readiness?.checks ?? {},
      queue: readiness?.queue ?? { length: 0, oldestJobAge: null },
      ffmpeg: readiness?.ffmpeg ?? { ok: false },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Unknown readiness error';

    return res.status(500).json({
      ok: false,
      error: {
        message: 'internal_error',
        detail,
      },
    });
  }
}