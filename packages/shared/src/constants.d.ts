/** Global constants shared across services */
export declare const BUCKET_VIDEOS = "videos";
export declare const BUCKET_TRANSCRIPTS = "transcripts";
export declare const BUCKET_RENDERS = "renders";
export declare const BUCKET_THUMBS = "thumbs";
/** Short-lived signed URLs for uploads/downloads */
export declare const SIGNED_URL_TTL_SEC = 600;
export declare const MAX_UPLOAD_FILE_BYTES = 2147483648;
/** Optional: common MIME/extension map for uploads */
export declare const EXTENSION_MIME_MAP: {
    readonly '.mp4': "video/mp4";
    readonly '.mov': "video/quicktime";
    readonly '.mkv': "video/x-matroska";
};
export type AllowedExtension = keyof typeof EXTENSION_MIME_MAP;
/** Utility */
export declare function getExtension(filename: string): AllowedExtension | undefined;
export declare const APP_NAME = "Cliply";
