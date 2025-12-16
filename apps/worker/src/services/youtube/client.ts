import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getEnv } from '@cliply/shared/env';
import { getFreshYouTubeAccessToken } from '@cliply/shared/services/youtubeAuth';
import { logger } from '@cliply/shared/logging/logger';

// Type-only imports for future implementation (T1-02 plan)
import type {
  YouTubeUploadParams,
  YouTubeUploadResult,
  YouTubeUploadSuccessResult,
  YouTubeUploadErrorResult,
  YouTubeClientErrorCode,
  YouTubeClientErrorDetails,
  YouTubePrivacyStatus,
} from './types';

/**
 * Legacy upload parameters interface.
 * Kept for backward compatibility with existing pipeline.
 * Future implementation will use YouTubeUploadParams from ./types.
 */
export interface UploadShortParams {
  workspaceId: string;
  connectedAccountId: string;
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
}

// Re-export types for convenience
export type {
  YouTubeUploadParams,
  YouTubeUploadResult,
  YouTubeUploadSuccessResult,
  YouTubeUploadErrorResult,
  YouTubeClientErrorCode,
  YouTubeClientErrorDetails,
  YouTubePrivacyStatus,
} from './types';

/**
 * Adapter function to map UploadShortParams to YouTubeUploadParams.
 * This bridges the legacy interface with the new typed interface.
 */
function mapUploadShortParamsToYouTube(params: UploadShortParams): YouTubeUploadParams {
  return {
    workspaceId: params.workspaceId,
    connectedAccountId: params.connectedAccountId,
    videoPath: params.filePath,
    title: params.title,
    description: params.description,
    tags: params.tags,
    privacyStatus: params.visibility ?? "unlisted",
    languageCode: undefined,
    madeForKids: false,
    scheduleAt: null,
  };
}

/**
 * Reads video file from a path (HTTP URL or local file path).
 * Returns a Buffer containing the video bytes.
 */
async function readVideoFile(videoPath: string): Promise<Buffer> {
  if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
    const response = await fetch(videoPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch video from URL: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } else {
    return await readFile(videoPath);
  }
}

/**
 * Parses YouTube API error response to extract error details.
 */
function parseYouTubeErrorResponse(
  errorJson: unknown,
): { reason?: string; message?: string } {
  if (typeof errorJson === 'object' && errorJson !== null) {
    const obj = errorJson as Record<string, unknown>;
    const error = obj.error;
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;
      return {
        reason: errorObj.reason as string | undefined,
        message: errorObj.message as string | undefined,
      };
    }
  }
  return {};
}

/**
 * Maps HTTP status code and error details to YouTubeClientErrorCode.
 */
function mapErrorCode(
  status: number,
  ytErrorReason?: string,
): YouTubeClientErrorCode {
  if (status === 401) {
    return 'INVALID_TOKEN';
  }
  if (status === 403) {
    if (ytErrorReason?.includes('quotaExceeded') || ytErrorReason === 'quotaExceeded') {
      return 'QUOTA_EXCEEDED';
    }
    if (ytErrorReason?.includes('authError') || ytErrorReason?.includes('insufficientPermissions')) {
      return 'EXPIRED_TOKEN';
    }
    return 'FORBIDDEN';
  }
  if (status >= 500) {
    return 'YOUTUBE_5XX';
  }
  if (status >= 400 && status < 500) {
    if (status === 413) {
      return 'PAYLOAD_TOO_LARGE';
    }
    if (status === 429) {
      return 'RATE_LIMIT_EXCEEDED';
    }
    return 'BAD_REQUEST';
  }
  return 'UNKNOWN';
}

/**
 * Determines if an error is retryable based on status code.
 */
function isRetryableError(status: number, code: YouTubeClientErrorCode): boolean {
  if (status >= 500) {
    return true;
  }
  if (code === 'QUOTA_EXCEEDED' || code === 'RATE_LIMIT_EXCEEDED' || code === 'TRANSIENT_NETWORK') {
    return true;
  }
  if (code === 'INVALID_TOKEN' || code === 'EXPIRED_TOKEN' || code === 'BAD_REQUEST' || code === 'FORBIDDEN' || code === 'PAYLOAD_TOO_LARGE') {
    return false;
  }
  // Default: retryable for unknown errors (conservative approach)
  return true;
}

/**
 * Internal helper for real YouTube uploads using multipart upload.
 * Not wired into uploadShort yet; used in later T1-2d/T1-2e steps.
 *
 * @param params - YouTube upload parameters (video path, metadata, etc.)
 * @param accessToken - OAuth2 bearer token for YouTube API
 * @returns Promise resolving to YouTubeUploadResult (success or error)
 */
export async function uploadVideoWithAccessToken(
  params: YouTubeUploadParams,
  accessToken: string,
): Promise<YouTubeUploadResult> {
  try {
    // Build snippet and status objects from params
    const snippet: Record<string, unknown> = {
      title: params.title,
      description: params.description ?? '',
      tags: params.tags ?? [],
    };
    if (params.languageCode) {
      snippet.defaultLanguage = params.languageCode;
    }

    const status: Record<string, unknown> = {
      privacyStatus: params.privacyStatus ?? 'unlisted',
      selfDeclaredMadeForKids: params.madeForKids ?? false,
    };
    // Note: scheduleAt will be integrated in a later step

    // Read video file (HTTP URL or local path)
    let videoBuffer: Buffer;
    try {
      videoBuffer = await readVideoFile(params.videoPath);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: `Failed to read video file: ${(error as Error).message}`,
          httpStatus: undefined,
          ytErrorReason: undefined,
          isRetryable: false,
        },
      };
    }

    // Build multipart body
    const boundary = `cliply-youtube-${randomUUID()}`;

    const metaPart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ snippet, status }),
      '',
    ].join('\r\n');

    const videoHeader = [
      `--${boundary}`,
      'Content-Type: video/mp4',
      '',
    ].join('\r\n');

    const closing = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(metaPart + '\r\n', 'utf8'),
      Buffer.from(videoHeader, 'utf8'),
      videoBuffer,
      Buffer.from(closing, 'utf8'),
    ]);

    // Make API request
    const response = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(bodyBuffer.length),
        },
        body: bodyBuffer,
      },
    );

    // Handle success response
    if (response.ok) {
      const json = (await response.json()) as {
        id?: string;
        snippet?: { publishedAt?: string };
        status?: { publishAt?: string };
      };

      const videoId = json.id;
      if (!videoId) {
        return {
          ok: false,
          error: {
            code: 'UNKNOWN',
            message: 'YouTube API returned success but no video ID',
            httpStatus: response.status,
            ytErrorReason: undefined,
            isRetryable: false,
          },
        };
      }

      const publishedAt =
        json.status?.publishAt ?? json.snippet?.publishedAt ?? null;

      return {
        ok: true,
        videoId,
        publishedAt,
      };
    }

    // Handle error response
    let errorJson: unknown;
    let errorText: string;
    try {
      errorJson = await response.json();
      errorText = JSON.stringify(errorJson);
    } catch {
      errorText = await response.text();
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = { message: errorText };
      }
    }

    const { reason: ytErrorReason, message: ytErrorMessage } =
      parseYouTubeErrorResponse(errorJson);

    const code = mapErrorCode(response.status, ytErrorReason);
    const isRetryable = isRetryableError(response.status, code);

    return {
      ok: false,
      error: {
        code,
        message: ytErrorMessage ?? `YouTube API error: ${response.status} ${response.statusText}`,
        httpStatus: response.status,
        ytErrorReason,
        isRetryable,
      },
    };
  } catch (error) {
    // Handle low-level errors (network, file IO, etc.)
    const errorMessage = (error as Error).message;
    const isNetworkError =
      errorMessage.includes('fetch') ||
      errorMessage.includes('network') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('ENOTFOUND');

    return {
      ok: false,
      error: {
        code: isNetworkError ? 'TRANSIENT_NETWORK' : 'UNKNOWN',
        message: errorMessage,
        httpStatus: undefined,
        ytErrorReason: undefined,
        isRetryable: true,
      },
    };
  }
}

// Helper to get the upload function - allows mocking in tests
// By using a function that returns the export, we can mock it
export function getUploadVideoFunction() {
  return uploadVideoWithAccessToken;
}

export class YouTubeClient {
  private readonly accessToken: string | undefined;
  private readonly supabase: SupabaseClient | undefined;

  constructor(config: { accessToken: string; supabase?: SupabaseClient }) {
    const token = config.accessToken?.trim();
    if (!token) {
      throw new Error('YouTube access token is required');
    }

    this.accessToken = token;
    this.supabase = config.supabase;
  }

  async uploadShort(params: UploadShortParams): Promise<{ videoId: string }> {
    // Convert legacy params to new typed params
    const ytParams = mapUploadShortParamsToYouTube(params);

    // Check upload mode from environment
    const env = getEnv();
    const mode = env.YOUTUBE_UPLOAD_MODE ?? "stub";

    // Real upload path: requires supabase client and mode set to "real"
    if (mode === "real" && this.supabase) {
      try {
        // Get a fresh access token for this connected account
        const accessToken = await getFreshYouTubeAccessToken(
          params.connectedAccountId,
          { supabase: this.supabase }
        );

        // Call the real upload helper (using helper function for testability)
        const uploadResult = await getUploadVideoFunction()(ytParams, accessToken);

        if (uploadResult.ok) {
          // Successfully uploaded to YouTube; return real videoId
          return { videoId: uploadResult.videoId };
        }

        // YouTube returned an error - log and fall back to stub
        logger.error("youtube_upload_failed", {
          workspaceId: params.workspaceId,
          connectedAccountId: params.connectedAccountId,
          errorCode: uploadResult.error.code,
          errorMessage: uploadResult.error.message,
          httpStatus: uploadResult.error.httpStatus,
          ytErrorReason: uploadResult.error.ytErrorReason,
          isRetryable: uploadResult.error.isRetryable,
        });
        // Fall through to stub path
      } catch (error) {
        // Log unexpected error and fall back to stub
        logger.error("youtube_upload_unexpected_error", {
          workspaceId: params.workspaceId,
          connectedAccountId: params.connectedAccountId,
          error: (error as Error)?.message ?? String(error),
        });
        // Fall through to stub path
      }
    }

    // Stub path: default and fallback
    const fakeVideoId = `dryrun_${randomUUID()}`;
    return { videoId: fakeVideoId };
  }
}

// uploadVideoWithAccessToken is exported above for testability
// getUploadVideoFunction allows tests to mock the upload function
