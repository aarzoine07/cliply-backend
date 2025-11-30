/**
 * Canonical pipeline name constants.
 * Used for structured logging, Sentry tags, and Machine orchestration.
 * 
 * These lowercase snake_case names represent pipeline identity across the system.
 * They map to job.kind values (UPPERCASE) but serve different purposes:
 * - job.kind: DB enum for job type
 * - pipeline name: Logging/observability identifier
 */

export const PIPELINE_TRANSCRIBE = 'transcribe';
export const PIPELINE_HIGHLIGHT_DETECT = 'highlight_detect';
export const PIPELINE_CLIP_RENDER = 'clip_render';
export const PIPELINE_PUBLISH_TIKTOK = 'publish_tiktok';
export const PIPELINE_PUBLISH_YOUTUBE = 'publish_youtube';

export type PipelineName =
  | 'transcribe'
  | 'highlight_detect'
  | 'clip_render'
  | 'publish_tiktok'
  | 'publish_youtube';

