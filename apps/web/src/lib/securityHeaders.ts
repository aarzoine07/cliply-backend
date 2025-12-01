import type { NextApiRequest, NextApiResponse } from "next";
import { getEnv } from "@cliply/shared/env";

/**
 * Apply baseline security headers to API responses.
 * These headers help protect against common web vulnerabilities.
 */
export function applySecurityHeaders(res: NextApiResponse): void {
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking attacks
  res.setHeader("X-Frame-Options", "DENY");

  // Control referrer information
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Disable XSS filter (modern browsers handle this better, but explicit)
  res.setHeader("X-XSS-Protection", "0");

  // Optional: Permissions Policy (conservative defaults)
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), speaker=()",
  );
}

/**
 * Get allowed CORS origins from environment.
 * Falls back to NEXT_PUBLIC_APP_URL and localhost for development.
 */
function getAllowedOrigins(): string[] {
  const env = getEnv();
  const origins: string[] = [];

  // Add NEXT_PUBLIC_APP_URL if set
  if (env.NEXT_PUBLIC_APP_URL) {
    origins.push(env.NEXT_PUBLIC_APP_URL);
  }

  // Add localhost origins for development
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://localhost:3001");
  }

  // Add any explicitly configured CORS origins
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (corsOrigins) {
    origins.push(...corsOrigins.split(",").map((origin) => origin.trim()));
  }

  return origins;
}

/**
 * Check if an origin is allowed for CORS.
 */
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  const allowedOrigins = getAllowedOrigins();
  return allowedOrigins.includes(origin);
}

/**
 * Apply CORS headers to the response.
 * Handles preflight OPTIONS requests and sets appropriate headers for actual requests.
 * 
 * @param req Request object
 * @param res Response object
 * @returns true if the response was ended (OPTIONS preflight), false otherwise
 */
export function applyCors(req: NextApiRequest, res: NextApiResponse): boolean {
  const origin = req.headers.origin;

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    if (origin && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key, X-Workspace-ID",
      );
      res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.status(200).end();
    return true;
  }

  // For actual requests, set CORS headers if origin is allowed
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  return false;
}

/**
 * Apply both security headers and CORS to a response.
 * Convenience function for endpoints that need both.
 * 
 * @param req Request object
 * @param res Response object
 * @returns true if the response was ended (OPTIONS preflight), false otherwise
 */
export function applySecurityAndCors(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  applySecurityHeaders(res);
  return applyCors(req, res);
}

