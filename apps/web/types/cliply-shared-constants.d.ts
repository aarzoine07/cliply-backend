declare module "@cliply/shared/constants" {
  /**
   * Minimal type surface for shared constants, matching packages/shared/src/constants.ts.
   * At runtime, the real implementation comes from @cliply/shared.
   */
  export const BUCKET_VIDEOS: string;
  export const BUCKET_TRANSCRIPTS: string;
  export const BUCKET_RENDERS: string;
  export const BUCKET_THUMBS: string;

  export const SIGNED_URL_TTL_SEC: number;
  export const MAX_UPLOAD_FILE_BYTES: number;

  export const EXTENSION_MIME_MAP: Record<string, string>;
  export type AllowedExtension = string;

  export function getExtension(filename: string): AllowedExtension | undefined;

  export const APP_NAME: string;
}
