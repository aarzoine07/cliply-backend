// FILE: apps/web/src/lib/securityHeaders.ts
// Minimal security + CORS helper for Next.js Pages API routes.

import type { NextApiRequest, NextApiResponse } from "next";

const ALLOWED_METHODS = ["POST", "OPTIONS"];
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "X-Idempotency-Key",
];

/**
 * Apply common security headers and handle CORS preflight.
 *
 * Returns:
 *   - true  -> the request has been fully handled (e.g. OPTIONS preflight)
 *   - false -> the caller should continue normal handling
 */
export function applySecurityAndCors(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  // Basic security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(","));
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(","));
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
