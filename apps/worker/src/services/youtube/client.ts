import { readFile, stat } from 'node:fs/promises';
import { withRetry, ServiceTemporarilyUnavailableError } from '@cliply/shared/resilience/externalServiceResilience';
import { youtubeCircuitBreaker } from '@cliply/shared/resilience/serviceCircuitBreakers';

export interface UploadShortParams {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
}

export interface UploadShortResult {
  videoId: string;
}

/**
 * Custom error class for YouTube API errors
 */
export class YouTubeApiError extends Error {
  readonly status: number;
  readonly youtubeErrorCode?: string;
  readonly youtubeErrorMessage?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    options?: {
      youtubeErrorCode?: string;
      youtubeErrorMessage?: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.youtubeErrorCode = options?.youtubeErrorCode;
    this.youtubeErrorMessage = options?.youtubeErrorMessage;
    // Determine if error is retryable based on status code
    this.retryable = options?.retryable ?? (status >= 500 || status === 429);
  }
}

/**
 * YouTube client for uploading videos using YouTube Data API v3
 * Implements resumable upload protocol for video uploads
 */
export class YouTubeClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: { accessToken: string }) {
    const token = config.accessToken?.trim();
    if (!token) {
      throw new Error('YouTube access token is required');
    }

    this.accessToken = token;
    this.baseUrl = 'https://www.googleapis.com';
    // Default timeout: 10 minutes for video uploads (YouTube can be slow)
    this.timeoutMs = 10 * 60 * 1000;
  }

  /**
   * Upload a YouTube Short
   * Implements YouTube Data API v3 resumable upload:
   * 1. Initialize resumable upload session (get upload URL)
   * 2. Upload video file to the resumable URL (returns video ID)
   * 
   * Uses retry logic and circuit breaker for resilience.
   */
  async uploadShort(params: UploadShortParams): Promise<UploadShortResult> {
    return withRetry(
      'youtube.uploadShort',
      async (attemptNumber) => {
        // Check circuit breaker
        if (youtubeCircuitBreaker.isOpen()) {
          throw new ServiceTemporarilyUnavailableError('YouTube');
        }

        try {
          // Step 1: Initialize resumable upload session
          const uploadUrl = await this.initResumableUpload(params);

          // Step 2: Upload video file (returns video ID in response)
          const { id: videoId } = await this.uploadFile(uploadUrl, params.filePath);

          // Record success
          youtubeCircuitBreaker.recordSuccess();

          return { videoId };
        } catch (error) {
          // Record failure if it's a retryable error
          if (this.shouldCountAsFailure(error)) {
            youtubeCircuitBreaker.recordFailure();
          }
          throw error;
        }
      },
      (error) => this.shouldRetryForYouTube(error),
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 10000,
      },
    );
  }

  /**
   * Determine if an error should be retried for YouTube
   */
  private shouldRetryForYouTube(error: unknown): boolean {
    // Network errors and timeouts
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return true;
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        return true;
      }
    }

    // YouTubeApiError with retryable flag
    if (error instanceof YouTubeApiError) {
      return error.retryable;
    }

    // Default: don't retry unknown errors
    return false;
  }

  /**
   * Determine if an error should count as a failure for the circuit breaker
   */
  private shouldCountAsFailure(error: unknown): boolean {
    // Count network errors, 5xx, and 429 as failures
    if (error instanceof YouTubeApiError) {
      return error.status >= 500 || error.status === 429 || error.retryable;
    }

    // Count network errors as failures
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return true;
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        return true;
      }
    }

    // Don't count 4xx client errors as circuit breaker failures
    return false;
  }

  /**
   * Step 1: Initialize resumable upload session
   * Returns the resumable upload URL
   */
  private async initResumableUpload(params: UploadShortParams): Promise<string> {
    const fileStats = await stat(params.filePath);
    const fileSize = fileStats.size;

    // Build metadata for the video
    const metadata = {
      snippet: {
        title: params.title,
        description: params.description || '',
        tags: params.tags || [],
        categoryId: '22', // People & Blogs category (commonly used for Shorts)
      },
      status: {
        privacyStatus: params.visibility || 'public',
        selfDeclaredMadeForKids: false,
      },
    };

    const url = `${this.baseUrl}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/*',
        'X-Upload-Content-Length': fileSize.toString(),
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new YouTubeApiError(
        `YouTube init upload failed: ${response.status} ${errorText}`,
        response.status,
        {
          retryable: response.status >= 500 || response.status === 429,
        },
      );
    }

    // Extract upload URL from Location header
    const location = response.headers.get('location');

    if (!location) {
      throw new YouTubeApiError(
        'YouTube init upload failed: missing Location header',
        500,
        { retryable: true },
      );
    }

    return location;
  }

  /**
   * Step 2: Upload video file to resumable URL
   * Returns the video resource from the final response
   */
  private async uploadFile(uploadUrl: string, filePath: string): Promise<{ id: string }> {
    const fileStats = await stat(filePath);
    const fileSize = fileStats.size;
    const fileData = await readFile(filePath);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/*',
          'Content-Length': fileSize.toString(),
        },
        body: fileData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new YouTubeApiError(
          `YouTube file upload failed: ${response.status} ${errorText}`,
          response.status,
          {
            retryable: response.status >= 500 || response.status === 429,
          },
        );
      }

      // Parse video resource from response
      const videoData = await response.json().catch(() => ({})) as {
        id?: string;
        snippet?: { title?: string };
      };

      if (!videoData.id) {
        throw new YouTubeApiError(
          'YouTube upload completed but video ID not found in response',
          500,
          { retryable: false },
        );
      }

      return { id: videoData.id };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof YouTubeApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new YouTubeApiError(
          'YouTube file upload timeout',
          408,
          { retryable: true },
        );
      }

      throw new YouTubeApiError(
        `YouTube file upload failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        { retryable: true },
      );
    }
  }


  /**
   * Make HTTP request with error handling
   */
  private async makeRequest(
    url: string,
    options: RequestInit,
  ): Promise<{ status: number; location?: string; headers?: Headers; [key: string]: unknown }> {
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

        throw new YouTubeApiError(
          `YouTube API authentication failed: ${errorData.error?.message || errorText}`,
          response.status,
          {
            youtubeErrorCode: errorData.error?.code,
            youtubeErrorMessage: errorData.error?.message || errorText,
            retryable: false,
          },
        );
      }

      // Handle rate limiting
      if (response.status === 429) {
        const errorText = await response.text().catch(() => 'Rate limited');
        throw new YouTubeApiError(
          `YouTube API rate limited: ${errorText}`,
          response.status,
          { retryable: true },
        );
      }

      // Handle server errors
      if (response.status >= 500) {
        const errorText = await response.text().catch(() => 'Server error');
        throw new YouTubeApiError(
          `YouTube API server error: ${errorText}`,
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

        throw new YouTubeApiError(
          `YouTube API request failed: ${errorData.error?.message || errorText}`,
          response.status,
          {
            youtubeErrorCode: errorData.error?.code,
            youtubeErrorMessage: errorData.error?.message || errorText,
            retryable: false,
          },
        );
      }

      // Extract Location header for resumable uploads
      const location = response.headers.get('location');

      // Parse JSON response if available
      const contentType = response.headers.get('content-type');
      let json: Record<string, unknown> = {};
      if (contentType?.includes('application/json')) {
        json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      }

      return {
        ...json,
        status: response.status,
        location: location || undefined,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof YouTubeApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new YouTubeApiError(
          'YouTube API request timeout',
          408,
          { retryable: true },
        );
      }

      throw new YouTubeApiError(
        `YouTube API request failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        { retryable: true },
      );
    }
  }
}
