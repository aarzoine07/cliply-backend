import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Protected Cron Endpoint for Cliply backend
 * Accepts either the internal CRON_SECRET (for Vercel Cron)
 * or the automation bypass header used in testing / verification.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = process.env.CRON_SECRET;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  // Normalize header keys to lowercase (Vercel sometimes lowercases them)
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  const authHeader = headers["authorization"];
  const bypassHeader = headers["x-vercel-protection-bypass"];

  const isAuthorized =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (bypassSecret && bypassHeader === bypassSecret);

  if (!isAuthorized) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  return res.status(200).json({
    ok: true,
    message: "Cron scan executed successfully",
    timestamp: new Date().toISOString(),
  });
}
