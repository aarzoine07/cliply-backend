/**
 * Type definitions for YouTube client upload operations.
 * These types support the YouTube Data API v3 integration plan (T1-02).
 */

/**
 * Privacy status for YouTube videos.
 * Maps directly to YouTube API privacyStatus field.
 */
export type YouTubePrivacyStatus = "public" | "unlisted" | "private";

/**
 * Parameters for uploading a video to YouTube.
 * Includes all metadata and configuration needed for video upload.
 */
export interface YouTubeUploadParams {
  /** Workspace ID that owns this upload. */
  workspaceId: string;

  /** Connected account ID for the YouTube channel to upload to. */
  connectedAccountId: string;

  /** Absolute file path or storage path to the MP4 video file. */
  videoPath: string;

  /** Video title (max 100 characters). */
  title: string;

  /** Video description (max 5000 characters). Optional. */
  description?: string;

  /** Array of tag strings (max 10 tags, 30 chars each, 500 chars total). Optional. */
  tags?: string[];

  /** Privacy status of the video. Defaults to "unlisted" if not specified. */
  privacyStatus?: YouTubePrivacyStatus;

  /** Language code for the video (e.g., "en", "es"). Optional. */
  languageCode?: string;

  /** Whether the video is made for kids. Defaults to false. */
  madeForKids?: boolean;

  /** Scheduled publish time. Optional; for future scheduling feature. */
  scheduleAt?: Date | null;
}

/**
 * Error codes for YouTube client operations.
 * Maps to common YouTube API error scenarios.
 */
export type YouTubeClientErrorCode =
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "QUOTA_EXCEEDED"
  | "BAD_REQUEST"
  | "TRANSIENT_NETWORK"
  | "YOUTUBE_5XX"
  | "RATE_LIMIT_EXCEEDED"
  | "TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "FORBIDDEN"
  | "UNKNOWN";

/**
 * Detailed error information for YouTube client operations.
 * Provides structured error data for logging and retry logic.
 */
export interface YouTubeClientErrorDetails {
  /** Error code categorizing the failure type. */
  code: YouTubeClientErrorCode;

  /** Human-readable error message. */
  message: string;

  /** HTTP status code from YouTube API (if applicable). */
  httpStatus?: number;

  /** YouTube API error reason/message (if available from API response). */
  ytErrorReason?: string;

  /** Whether this error is retryable (transient failures). */
  isRetryable?: boolean;
}

/**
 * Success result from YouTube upload operation.
 * Returned when video upload completes successfully.
 */
export interface YouTubeUploadSuccessResult {
  /** Discriminator flag indicating success. */
  ok: true;

  /** YouTube video ID (e.g., "dQw4w9WgXcQ"). */
  videoId: string;

  /** ISO timestamp of when the video was published. Optional. */
  publishedAt?: string | null;
}

/**
 * Error result from YouTube upload operation.
 * Returned when video upload fails.
 */
export interface YouTubeUploadErrorResult {
  /** Discriminator flag indicating failure. */
  ok: false;

  /** Detailed error information. */
  error: YouTubeClientErrorDetails;
}

/**
 * Result from YouTube upload operation.
 * Discriminated union of success or error result.
 */
export type YouTubeUploadResult = YouTubeUploadSuccessResult | YouTubeUploadErrorResult;

