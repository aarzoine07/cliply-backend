/** Global constants shared across services */

export const BUCKET_VIDEOS = 'videos';
export const BUCKET_TRANSCRIPTS = 'transcripts';
export const BUCKET_RENDERS = 'renders';
export const BUCKET_THUMBS = 'thumbs';

/** Short-lived signed URLs for uploads/downloads */
export const SIGNED_URL_TTL_SEC = 600;

export const MAX_UPLOAD_FILE_BYTES = 2_147_483_648; // 2GB

/** Optional: common MIME/extension map for uploads */
export const EXTENSION_MIME_MAP = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
} as const;

export type AllowedExtension = keyof typeof EXTENSION_MIME_MAP;

/** Utility */
export function getExtension(filename: string): AllowedExtension | undefined {
  const i = filename.lastIndexOf('.');
  if (i < 0) return undefined;
  const ext = filename.slice(i).toLowerCase();
  return (Object.keys(EXTENSION_MIME_MAP) as AllowedExtension[]).includes(ext as AllowedExtension)
    ? (ext as AllowedExtension)
    : undefined;
}

// Legacy global
export const APP_NAME = 'Cliply';
