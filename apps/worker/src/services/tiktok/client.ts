import { readFile } from 'node:fs/promises';
import { getEnv } from '@cliply/shared/env';

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
   */
  async uploadVideo(params: UploadVideoParams): Promise<UploadVideoResult> {
    // Step 1: Initialize upload
    const initResult = await this.initUpload(params);
    const { upload_url, publish_id } = initResult;

    // Step 2: Upload video file
    await this.uploadFile(upload_url, params.filePath);

    // Step 3: Publish video
    const publishResult = await this.publishVideo(publish_id, params);

    return {
      videoId: publishResult.video_id,
      rawResponse: publishResult,
    };
  }

  /**
   * Step 1: Initialize upload to get upload URL and publish ID
   */
  private async initUpload(params: UploadVideoParams): Promise<{
    upload_url: string;
    publish_id: string;
  }> {
    const url = `${this.baseUrl}/v2/post/publish/inbox/video/init/`;

    const requestBody = {
      post_info: {
        title: params.caption || '',
        privacy_level: params.privacyLevel || 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
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
   */
  private async publishVideo(
    publishId: string,
    params: UploadVideoParams,
  ): Promise<{
    video_id: string;
  }> {
    const url = `${this.baseUrl}/v2/post/publish/`;

    const requestBody = {
      publish_id: publishId,
      post_info: {
        title: params.caption || '',
        privacy_level: params.privacyLevel || 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
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

