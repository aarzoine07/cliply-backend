import { z } from 'zod';
export declare const UploadInitFileInput: z.ZodObject<{
    source: z.ZodLiteral<"file">;
    filename: z.ZodString;
    size: z.ZodNumber;
    mime: z.ZodEnum<{
        "video/mp4": "video/mp4";
        "video/quicktime": "video/quicktime";
        "video/x-matroska": "video/x-matroska";
    }>;
}, z.core.$strict>;
export declare const UploadInitYouTubeInput: z.ZodObject<{
    source: z.ZodLiteral<"youtube">;
    url: z.ZodString;
}, z.core.$strict>;
export declare const UploadInitInput: z.ZodDiscriminatedUnion<[z.ZodObject<{
    source: z.ZodLiteral<"file">;
    filename: z.ZodString;
    size: z.ZodNumber;
    mime: z.ZodEnum<{
        "video/mp4": "video/mp4";
        "video/quicktime": "video/quicktime";
        "video/x-matroska": "video/x-matroska";
    }>;
}, z.core.$strict>, z.ZodObject<{
    source: z.ZodLiteral<"youtube">;
    url: z.ZodString;
}, z.core.$strict>], "source">;
export declare const UploadInitFileOut: z.ZodObject<{
    uploadUrl: z.ZodString;
    storagePath: z.ZodString;
    projectId: z.ZodString;
}, z.core.$strict>;
export declare const UploadInitYtOut: z.ZodObject<{
    projectId: z.ZodString;
}, z.core.$strict>;
/** ---------- Clip Meta & Moderation ---------- */
export declare const ClipMetaUpdateInput: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const ClipApproveInput: z.ZodObject<{
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ClipRejectInput: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strict>;
/** ---------- AI Clip Meta ---------- */
export declare const AIClipMetaRequest: z.ZodObject<{
    transcript: z.ZodString;
    titleHint: z.ZodOptional<z.ZodString>;
    style: z.ZodOptional<z.ZodEnum<{
        educational: "educational";
        storytime: "storytime";
        debate: "debate";
        comedy: "comedy";
        news: "news";
    }>>;
}, z.core.$strict>;
export declare const AIClipMetaResponse: z.ZodObject<{
    title: z.ZodString;
    hashtags: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/** ---------- Publish: YouTube ---------- */
export declare const PublishYouTubeInput: z.ZodObject<{
    clipId: z.ZodString;
    visibility: z.ZodEnum<{
        public: "public";
        unlisted: "unlisted";
        private: "private";
    }>;
    scheduleAt: z.ZodOptional<z.ZodString>;
    accountId: z.ZodOptional<z.ZodString>;
    titleOverride: z.ZodOptional<z.ZodString>;
    descriptionOverride: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** ---------- Schedules: cancel ---------- */
export declare const ScheduleCancelInput: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** ---------- Product/Dropshipper attach ---------- */
export declare const ProductAttachInput: z.ZodObject<{
    clipId: z.ZodString;
    url: z.ZodString;
    utm: z.ZodOptional<z.ZodObject<{
        source: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        medium: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        campaign: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        content: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        term: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
/** ---------- Types from schemas ---------- */
export * from './schemas/jobs';
