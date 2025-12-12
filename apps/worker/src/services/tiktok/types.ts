/**
 * Type definitions for TikTok client upload operations.
 * These types support the TikTok Content Posting API integration plan (T2-00).
 */

/**
 * Privacy level for TikTok posts.
 * Maps directly to TikTok API privacy_level field.
 */
export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIEND"
  | "SELF_ONLY";

/**
 * Parameters for uploading a video to TikTok.
 * Includes all metadata and configuration needed for video upload.
 */
export interface TikTokUploadParams {
  /**
   * Workspace owning this upload. Used for logging and telemetry.
   */
  workspaceId: string;

  /**
   * Connected TikTok account that will publish the video.
   */
  connectedAccountId: string;

  /**
   * Absolute file system path to the MP4 video file to upload.
   */
  videoPath: string;

  /**
   * Caption text for the TikTok post (TikTok enforces its own length limits).
   */
  caption?: string;

  /**
   * Optional hashtags to include or track separately.
   * TikTok will still parse hashtags from the caption itself.
   */
  hashtags?: string[];

  /**
   * Privacy level for the TikTok post.
   * Defaults to "PUBLIC_TO_EVERYONE" at the client/pipeline layer.
   */
  privacyLevel?: TikTokPrivacyLevel;

  /**
   * Whether to disable duet on this video.
   * Defaults to false at the client/pipeline layer.
   */
  disableDuet?: boolean;

  /**
   * Whether to disable comments on this video.
   * Defaults to false at the client/pipeline layer.
   */
  disableComment?: boolean;

  /**
   * Whether to disable stitch on this video.
   * Defaults to false at the client/pipeline layer.
   */
  disableStitch?: boolean;

  /**
   * Milliseconds into the video to use for the thumbnail/cover frame.
   * Defaults to 1000 at the client/pipeline layer.
   */
  videoCoverTimestampMs?: number;
}

/**
 * Error codes for TikTok client operations.
 * Maps to common TikTok API error scenarios.
 */
export type TikTokClientErrorCode =
  | "INVALID_TOKEN" // 401 - Token expired/invalid
  | "INSUFFICIENT_SCOPE" // 403 - Missing video.upload scope
  | "FORBIDDEN" // 403 - Account restrictions, moderation, etc.
  | "RATE_LIMITED" // 429 - Rate limit exceeded
  | "BAD_REQUEST" // 400 - Invalid video/caption/metadata
  | "UPLOAD_URL_EXPIRED" // 400/410 - Upload URL from init expired
  | "PUBLISH_ID_NOT_FOUND" // 404 - Publish ID invalid/expired
  | "TIKTOK_5XX" // 500+ - TikTok server errors
  | "TRANSIENT_NETWORK" // Network timeouts, connection issues
  | "TIMEOUT" // Request timeout
  | "UNKNOWN"; // Unknown/unexpected errors

/**
 * Detailed error information for TikTok client operations.
 * Provides structured error data for logging and retry logic.
 */
export interface TikTokClientErrorDetails {
  /**
   * High-level client error code that categorizes the failure type.
   */
  code: TikTokClientErrorCode;

  /**
   * Human-readable error message for logs and debugging.
   */
  message: string;

  /**
   * HTTP status code returned by TikTok, if applicable.
   */
  httpStatus?: number;

  /**
   * Raw TikTok API error code, if available from the response body.
   */
  tiktokErrorCode?: string;

  /**
   * Raw TikTok API error message, if available from the response body.
   */
  tiktokErrorMessage?: string;

  /**
   * Whether this error is considered retryable by the client.
   * Transient network issues and 5xx responses should typically set this to true.
   */
  isRetryable?: boolean;
}

/**
 * Success result from TikTok upload operation.
 * Returned when video upload completes successfully.
 */
export interface TikTokUploadSuccessResult {
  /**
   * Discriminator flag indicating success.
   */
  ok: true;

  /**
   * TikTok video/post identifier (typically a numeric string).
   */
  postId: string;

  /**
   * When the video was published, if available as an ISO timestamp.
   */
  publishedAt?: string | null;
}

/**
 * Error result from TikTok upload operation.
 * Returned when video upload fails.
 */
export interface TikTokUploadErrorResult {
  /**
   * Discriminator flag indicating failure.
   */
  ok: false;

  /**
   * Detailed error information.
   */
  error: TikTokClientErrorDetails;
}

/**
 * Result from TikTok upload operation.
 * Discriminated union of success or error result.
 */
export type TikTokUploadResult =
  | TikTokUploadSuccessResult
  | TikTokUploadErrorResult;

