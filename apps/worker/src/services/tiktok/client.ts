import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getEnv } from '@cliply/shared/env';
import type {
  TikTokUploadParams,
  TikTokUploadResult,
  TikTokClientErrorCode,
  TikTokClientErrorDetails,
} from './types';

export interface UploadVideoParams {
  filePath: string;
  caption?: string;
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIEND' | 'SELF_ONLY';
}

export interface UploadVideoResult {
  videoId: string;
  rawResponse: unknown;
}

/**
 * Custom error class for TikTok API errors
 */
export class TikTokApiError extends Error {
  readonly status: number;
  readonly tiktokErrorCode?: string;
  readonly tiktokErrorMessage?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    options?: {
      tiktokErrorCode?: string;
      tiktokErrorMessage?: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'TikTokApiError';
    this.status = status;
    this.tiktokErrorCode = options?.tiktokErrorCode;
    this.tiktokErrorMessage = options?.tiktokErrorMessage;
    // Determine if error is retryable based on status code
    this.retryable = options?.retryable ?? (status >= 500 || status === 429);
  }
}

/**
 * Maps a TikTokApiError to TikTokClientErrorDetails with appropriate error code.
 */
function mapTikTokApiErrorToErrorDetails(error: TikTokApiError): TikTokClientErrorDetails {
  let code: TikTokClientErrorCode = 'UNKNOWN';

  // Map HTTP status codes to error codes
  if (error.status === 401) {
    code = 'INVALID_TOKEN';
  } else if (error.status === 403) {
    // Could be insufficient scope or forbidden (account restrictions)
    // Check error message/code for more specific classification
    if (error.tiktokErrorCode?.toLowerCase().includes('scope') || 
        error.tiktokErrorMessage?.toLowerCase().includes('scope')) {
      code = 'INSUFFICIENT_SCOPE';
    } else {
      code = 'FORBIDDEN';
    }
  } else if (error.status === 429) {
    code = 'RATE_LIMITED';
  } else if (error.status === 400) {
    // Could be bad request or upload URL expired
    if (error.tiktokErrorCode?.toLowerCase().includes('expired') ||
        error.tiktokErrorMessage?.toLowerCase().includes('expired')) {
      code = 'UPLOAD_URL_EXPIRED';
    } else {
      code = 'BAD_REQUEST';
    }
  } else if (error.status === 404) {
    code = 'PUBLISH_ID_NOT_FOUND';
  } else if (error.status === 410) {
    code = 'UPLOAD_URL_EXPIRED';
  } else if (error.status >= 500) {
    code = 'TIKTOK_5XX';
  } else if (error.status === 408 || error.message.toLowerCase().includes('timeout')) {
    code = 'TIMEOUT';
  } else if (error.message.toLowerCase().includes('network') || 
             error.message.toLowerCase().includes('connection')) {
    code = 'TRANSIENT_NETWORK';
  }

  return {
    code,
    message: error.message,
    httpStatus: error.status,
    tiktokErrorCode: error.tiktokErrorCode,
    tiktokErrorMessage: error.tiktokErrorMessage,
    isRetryable: error.retryable,
  };
}

/**
 * Adapter from public UploadVideoParams to internal TikTokUploadParams.
 * Note: workspaceId and connectedAccountId are not available in the current public API,
 * so they are set to empty strings. These are primarily used for logging/telemetry.
 */
function mapToTikTokUploadParams(
  params: UploadVideoParams,
  workspaceId: string = '',
  connectedAccountId: string = '',
): TikTokUploadParams {
  return {
    workspaceId,
    connectedAccountId,
    videoPath: params.filePath,
    caption: params.caption,
    privacyLevel: params.privacyLevel,
    // Defaults match current behavior in initUpload/publishVideo
    disableDuet: false,
    disableComment: false,
    disableStitch: false,
    videoCoverTimestampMs: 1000,
  };
}

export class TikTokClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: { accessToken: string }) {
    const token = config.accessToken?.trim();
    if (!token) {
      throw new Error('TikTok access token is required');
    }

    this.accessToken = token;
    const env = getEnv();
    // TikTok API base URL
    this.baseUrl = 'https://open.tiktokapis.com';
    // Default timeout: 5 minutes for video uploads
    this.timeoutMs = 5 * 60 * 1000;
  }

  /**
   * Upload a video to TikTok
   * Implements the three-step TikTok API flow:
   * 1. Initialize upload (get upload URL)
   * 2. Upload video file to the upload URL
   * 3. Publish video
   * 
   * Behavior is controlled by TIKTOK_UPLOAD_MODE env var:
   * - "stub" (default): Returns fake post ID without network calls
   * - "real": Calls TikTok Content Posting API
   */
  async uploadVideo(params: UploadVideoParams): Promise<UploadVideoResult> {
    // Check upload mode from environment
    const env = getEnv();
    const mode = env.TIKTOK_UPLOAD_MODE ?? "stub";

    // Real upload path: requires mode set to "real"
    if (mode === "real") {
      // Convert to internal params (workspaceId/connectedAccountId not available in public API)
      const internalParams = mapToTikTokUploadParams(params);

      // Perform upload using internal function that returns TikTokUploadResult
      const result = await this.performTikTokUpload(internalParams);

      // Convert result back to public API format
      if (result.ok) {
        return {
          videoId: result.postId,
          rawResponse: { video_id: result.postId, publishedAt: result.publishedAt },
        };
      }

      // Convert error result back to TikTokApiError to preserve existing behavior
      const errorDetails = result.error;
      throw new TikTokApiError(
        errorDetails.message,
        errorDetails.httpStatus ?? 500,
        {
          tiktokErrorCode: errorDetails.tiktokErrorCode,
          tiktokErrorMessage: errorDetails.tiktokErrorMessage,
          retryable: errorDetails.isRetryable,
        },
      );
    }

    // Stub path: default and when mode is not "real"
    const fakePostId = `dryrun_${randomUUID()}`;
    return {
      videoId: fakePostId,
      rawResponse: { video_id: fakePostId, publishedAt: null },
    };
  }

  /**
   * Internal upload function that returns TikTokUploadResult.
   * This is the new typed interface, but kept private to maintain public API compatibility.
   */
  private async performTikTokUpload(params: TikTokUploadParams): Promise<TikTokUploadResult> {
    try {
      // Step 1: Initialize upload
      const initResult = await this.initUploadInternal(params);
      const { upload_url, publish_id } = initResult;

      // Step 2: Upload video file
      await this.uploadFile(upload_url, params.videoPath);

      // Step 3: Publish video
      const publishResult = await this.publishVideoInternal(publish_id, params);

      return {
        ok: true,
        postId: publishResult.video_id,
        publishedAt: null, // TikTok API doesn't return publishedAt in the response
      };
    } catch (error) {
      // Convert TikTokApiError to TikTokUploadErrorResult
      if (error instanceof TikTokApiError) {
        return {
          ok: false,
          error: mapTikTokApiErrorToErrorDetails(error),
        };
      }

      // For unexpected errors, wrap in UNKNOWN error code
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
          isRetryable: false,
        },
      };
    }
  }

  /**
   * Step 1: Initialize upload to get upload URL and publish ID
   * Internal version that uses TikTokUploadParams.
   */
  private async initUploadInternal(params: TikTokUploadParams): Promise<{
    upload_url: string;
    publish_id: string;
  }> {
    const url = `${this.baseUrl}/v2/post/publish/inbox/video/init/`;

    const requestBody = {
      post_info: {
        title: params.caption || '',
        privacy_level: params.privacyLevel || 'PUBLIC_TO_EVERYONE',
        disable_duet: params.disableDuet ?? false,
        disable_comment: params.disableComment ?? false,
        disable_stitch: params.disableStitch ?? false,
        video_cover_timestamp_ms: params.videoCoverTimestampMs ?? 1000,
      },
      source_info: {
        source: 'FILE_UPLOAD',
      },
    };

    const response = await this.makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = response as {
      status: number;
      data?: {
        upload_url?: string;
        publish_id?: string;
      };
      error?: {
        code?: string;
        message?: string;
        log_id?: string;
      };
    };

    if (data.error) {
      throw new TikTokApiError(
        `TikTok init upload failed: ${data.error.message || 'Unknown error'}`,
        data.status || 400,
        {
          tiktokErrorCode: data.error.code,
          tiktokErrorMessage: data.error.message,
          retryable: false,
        },
      );
    }

    if (!data.data?.upload_url || !data.data?.publish_id) {
      throw new TikTokApiError(
        'TikTok init upload failed: missing upload_url or publish_id',
        500,
        { retryable: true },
      );
    }

    return {
      upload_url: data.data.upload_url,
      publish_id: data.data.publish_id,
    };
  }

  /**
   * Step 2: Upload video file to the upload URL
   */
  private async uploadFile(uploadUrl: string, filePath: string): Promise<void> {
    const videoData = await readFile(filePath);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length.toString(),
      },
      body: videoData,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new TikTokApiError(
        `TikTok file upload failed: ${response.status} ${errorText}`,
        response.status,
        {
          retryable: response.status >= 500 || response.status === 429,
        },
      );
    }
  }

  /**
   * Step 3: Publish the uploaded video
   * Internal version that uses TikTokUploadParams.
   */
  private async publishVideoInternal(
    publishId: string,
    params: TikTokUploadParams,
  ): Promise<{
    video_id: string;
  }> {
    const url = `${this.baseUrl}/v2/post/publish/`;

    const requestBody = {
      publish_id: publishId,
      post_info: {
        title: params.caption || '',
        privacy_level: params.privacyLevel || 'PUBLIC_TO_EVERYONE',
        disable_duet: params.disableDuet ?? false,
        disable_comment: params.disableComment ?? false,
        disable_stitch: params.disableStitch ?? false,
        video_cover_timestamp_ms: params.videoCoverTimestampMs ?? 1000,
      },
    };

    const response = await this.makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = response as {
      status: number;
      data?: {
        publish_id?: string;
        upload_url?: string;
        video_id?: string;
      };
      error?: {
        code?: string;
        message?: string;
        log_id?: string;
      };
    };

    if (data.error) {
      throw new TikTokApiError(
        `TikTok publish failed: ${data.error.message || 'Unknown error'}`,
        data.status || 400,
        {
          tiktokErrorCode: data.error.code,
          tiktokErrorMessage: data.error.message,
          retryable: false,
        },
      );
    }

    if (!data.data?.video_id) {
      throw new TikTokApiError(
        'TikTok publish failed: missing video_id',
        500,
        { retryable: true },
      );
    }

    return {
      video_id: data.data.video_id,
    };
  }

  /**
   * Make HTTP request with error handling
   * Returns parsed JSON response with status code attached
   */
  private async makeRequest(
    url: string,
    options: RequestInit,
  ): Promise<{ status: number; [key: string]: unknown }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text().catch(() => 'Authentication failed');
        let errorData: { error?: { code?: string; message?: string } } = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON, use text as message
        }

        throw new TikTokApiError(
          `TikTok API authentication failed: ${errorData.error?.message || errorText}`,
          response.status,
          {
            tiktokErrorCode: errorData.error?.code,
            tiktokErrorMessage: errorData.error?.message || errorText,
            retryable: false,
          },
        );
      }

      // Handle rate limiting
      if (response.status === 429) {
        const errorText = await response.text().catch(() => 'Rate limited');
        throw new TikTokApiError(
          `TikTok API rate limited: ${errorText}`,
          response.status,
          { retryable: true },
        );
      }

      // Handle server errors
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => 'Server error');
        throw new TikTokApiError(
          `TikTok API server error: ${errorText}`,
          response.status,
          { retryable: true },
        );
      }

      // For non-OK responses, try to parse error
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Request failed');
        let errorData: { error?: { code?: string; message?: string } } = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON, use text as message
        }

        throw new TikTokApiError(
          `TikTok API request failed: ${errorData.error?.message || errorText}`,
          response.status,
          {
            tiktokErrorCode: errorData.error?.code,
            tiktokErrorMessage: errorData.error?.message || errorText,
            retryable: false,
          },
        );
      }

      // Parse JSON response
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ...json, status: response.status };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof TikTokApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TikTokApiError(
          'TikTok API request timeout',
          408,
          { retryable: true },
        );
      }

      throw new TikTokApiError(
        `TikTok API request failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        { retryable: true },
      );
    }
  }
}

