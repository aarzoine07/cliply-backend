/**
 * Deprecation header helpers for health endpoints.
 * Used to signal that legacy endpoints are deprecated and point to canonical successors.
 */

import type { NextApiResponse } from "next";

/**
 * Sets deprecation headers on a Next.js Pages Router response.
 * 
 * @param res NextApiResponse to set headers on
 * @param successorPath The canonical endpoint path that replaces this deprecated endpoint
 * @param sunsetDate ISO date string when the endpoint will be removed (default: 2026-03-01)
 */
export function setDeprecationHeaders(
  res: NextApiResponse,
  successorPath: string,
  sunsetDate: string = "2026-03-01",
): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", sunsetDate);
  res.setHeader("Link", `<${successorPath}>; rel="successor-version"`);
}

