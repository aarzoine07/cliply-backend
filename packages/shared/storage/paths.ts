/** 
 * Storage path builders and bucket constants
 * 
 * This module defines canonical bucket names and path construction functions
 * for all storage artifacts in Cliply.
 */

// ============================================================================
// BUCKET CONSTANTS
// ============================================================================

/**
 * Videos bucket: stores original uploaded source files
 * Path pattern: {workspaceId}/{projectId}/source.{ext}
 */
export const BUCKET_VIDEOS = 'videos';

/**
 * Transcripts bucket: stores transcript files (SRT + JSON)
 * Path patterns: 
 *   - {workspaceId}/{projectId}/transcript.srt
 *   - {workspaceId}/{projectId}/transcript.json
 */
export const BUCKET_TRANSCRIPTS = 'transcripts';

/**
 * Renders bucket: stores rendered clip videos
 * Path pattern: {workspaceId}/{projectId}/{clipId}.{ext}
 */
export const BUCKET_RENDERS = 'renders';

/**
 * Thumbnails bucket: stores clip thumbnail images
 * Path pattern: {workspaceId}/{projectId}/{clipId}.{ext}
 */
export const BUCKET_THUMBS = 'thumbs';

// ============================================================================
// PATH BUILDERS
// ============================================================================

/**
 * Builds storage path for original uploaded project source file
 * Stored in BUCKET_VIDEOS
 * 
 * @param workspaceId - Workspace UUID
 * @param projectId - Project UUID
 * @param ext - File extension (e.g., 'mp4', 'mov')
 * @returns Path: `{workspaceId}/{projectId}/source.{ext}`
 */
export function projectSourcePath(workspaceId: string, projectId: string, ext: string): string {
  return `${workspaceId}/${projectId}/source.${ext}`;
}

/**
 * Builds storage path for transcript SRT file
 * Stored in BUCKET_TRANSCRIPTS
 * 
 * @param workspaceId - Workspace UUID
 * @param projectId - Project UUID
 * @returns Path: `{workspaceId}/{projectId}/transcript.srt`
 */
export function transcriptSrtPath(workspaceId: string, projectId: string): string {
  return `${workspaceId}/${projectId}/transcript.srt`;
}

/**
 * Builds storage path for transcript JSON file
 * Stored in BUCKET_TRANSCRIPTS
 * 
 * @param workspaceId - Workspace UUID
 * @param projectId - Project UUID
 * @returns Path: `{workspaceId}/{projectId}/transcript.json`
 */
export function transcriptJsonPath(workspaceId: string, projectId: string): string {
  return `${workspaceId}/${projectId}/transcript.json`;
}

/**
 * Builds storage path for rendered clip video
 * Stored in BUCKET_RENDERS
 * 
 * @param workspaceId - Workspace UUID
 * @param projectId - Project UUID (used for grouping)
 * @param clipId - Clip UUID
 * @param ext - File extension (typically 'mp4')
 * @returns Path: `{workspaceId}/{projectId}/{clipId}.{ext}`
 */
export function clipRenderPath(workspaceId: string, projectId: string, clipId: string, ext: string): string {
  return `${workspaceId}/${projectId}/${clipId}.${ext}`;
}

/**
 * Builds storage path for clip thumbnail image
 * Stored in BUCKET_THUMBS
 * 
 * @param workspaceId - Workspace UUID
 * @param projectId - Project UUID (used for grouping)
 * @param clipId - Clip UUID
 * @param ext - File extension (typically 'jpg' or 'png')
 * @returns Path: `{workspaceId}/{projectId}/{clipId}.{ext}`
 */
export function clipThumbnailPath(workspaceId: string, projectId: string, clipId: string, ext: string): string {
  return `${workspaceId}/${projectId}/${clipId}.${ext}`;
}

