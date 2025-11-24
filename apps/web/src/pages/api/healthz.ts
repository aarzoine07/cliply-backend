import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Lightweight health check endpoint
 * Returns 200 if the process is alive and responding
 * Does NOT perform any external checks (DB, queue, etc.)
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const body = {
    ok: true,
    service: "api",
    ts: new Date().toISOString(),
  };

  res.status(200).json(body);
}

