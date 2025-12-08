/**
 * Video input validation and URL parsing for YouTube, TikTok, and direct URLs.
 * Provides guardrails to reject unsafe URLs (local IPs, file://, etc.) before processing.
 */

import { InvalidVideoUrlError } from "../errors/video";

export type SupportedVideoSource =
  | { kind: "YOUTUBE"; videoId: string; url: string }
  | { kind: "TIKTOK"; url: string }
  | { kind: "DIRECT_URL"; url: string };

/**
 * Checks if a hostname or IP address is a private/local address.
 */
function isPrivateAddress(hostname: string): boolean {
  // Check for localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("0.0.0.0")
  ) {
    return true;
  }

  // Check for private IP ranges
  // 10.0.0.0/8
  if (hostname.startsWith("10.")) {
    return true;
  }

  // 172.16.0.0/12 (172.16-31.x.x)
  const parts = hostname.split(".");
  if (parts.length >= 2) {
    const first = parseInt(parts[0] ?? "0", 10);
    const second = parseInt(parts[1] ?? "0", 10);
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
  }

  // 192.168.0.0/16
  if (hostname.startsWith("192.168.")) {
    return true;
  }

  return false;
}

/**
 * Extracts video ID from various YouTube URL formats.
 */
function extractYouTubeVideoId(url: URL): string | null {
  const hostname = url.hostname.toLowerCase();

  // youtube.com/watch?v=VIDEO_ID
  if (hostname.includes("youtube.com")) {
    const videoId = url.searchParams.get("v");
    if (videoId) {
      return videoId;
    }

    // youtube.com/shorts/VIDEO_ID
    if (url.pathname.startsWith("/shorts/")) {
      const videoId = url.pathname.slice("/shorts/".length).split("/")[0];
      if (videoId) {
        return videoId;
      }
    }

    // youtube.com/embed/VIDEO_ID
    if (url.pathname.startsWith("/embed/")) {
      const videoId = url.pathname.slice("/embed/".length).split("/")[0];
      if (videoId) {
        return videoId;
      }
    }
  }

  // youtu.be/VIDEO_ID
  if (hostname.includes("youtu.be")) {
    const pathname = url.pathname;
    const videoId = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (videoId && !videoId.includes("/")) {
      return videoId;
    }
  }

  return null;
}

/**
 * Parses and validates a video source URL.
 * 
 * Rejects:
 * - Non-http(s) protocols (file:, ftp:, etc.)
 * - Private IP addresses and localhost
 * - Invalid YouTube URLs
 * 
 * @param rawUrl Raw URL string from user input
 * @returns Parsed and validated video source
 * @throws InvalidVideoUrlError if URL is invalid or unsafe
 */
export function parseAndValidateVideoSource(rawUrl: string): SupportedVideoSource {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new InvalidVideoUrlError("URL is required", rawUrl, "empty_url");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new InvalidVideoUrlError(
      `Invalid URL format: ${error instanceof Error ? error.message : String(error)}`,
      rawUrl,
      "invalid_format",
    );
  }

  // Reject non-http(s) protocols
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new InvalidVideoUrlError(
      `Unsupported protocol: ${protocol}. Only http:// and https:// are allowed`,
      rawUrl,
      "unsupported_protocol",
    );
  }

  // Reject private/local addresses
  const hostname = url.hostname.toLowerCase();
  if (isPrivateAddress(hostname)) {
    throw new InvalidVideoUrlError(
      `Private or local address not allowed: ${hostname}`,
      rawUrl,
      "private_address",
    );
  }

  // Try to parse as YouTube URL
  const youtubeVideoId = extractYouTubeVideoId(url);
  if (youtubeVideoId) {
    return {
      kind: "YOUTUBE",
      videoId: youtubeVideoId,
      url: rawUrl,
    };
  }

  // Check for TikTok URLs (basic validation - can be enhanced later)
  if (hostname.includes("tiktok.com")) {
    // For now, accept TikTok URLs as-is
    // TODO: Extract video ID if needed in the future
    return {
      kind: "TIKTOK",
      url: rawUrl,
    };
  }

  // Fallback to direct URL (must be http/https and not private)
  return {
    kind: "DIRECT_URL",
    url: rawUrl,
  };
}

