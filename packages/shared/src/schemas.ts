import { z } from 'zod';

import {
  EXTENSION_MIME_MAP,
  getExtension,
  MAX_UPLOAD_FILE_BYTES,
} from './constants';

/** ---------- Upload Init ---------- */

const FileMimeEnum = z.enum([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
]);

export const UploadInitFileInput = z
  .object({
    source: z.literal('file'),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\\/:*?"<>|]+$/, 'filename contains invalid characters'),
    size: z.number().int().positive().max(MAX_UPLOAD_FILE_BYTES, 'file too large'),
    mime: FileMimeEnum,
  })
  .strict()
  .superRefine((val, ctx) => {
    const ext = getExtension(val.filename);
    if (!ext) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unsupported file extension',
        path: ['filename'],
      });
      return;
    }

    const expected = EXTENSION_MIME_MAP[ext];
    if (val.mime !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'mime does not match extension',
        path: ['mime'],
      });
    }
  });

export const UploadInitYouTubeInput = z
  .object({
    source: z.literal('youtube'),
    url: z.string().url(),
  })
  .strict();

export const UploadInitInput = z.discriminatedUnion('source', [
  UploadInitFileInput,
  UploadInitYouTubeInput,
]);

export const UploadInitFileOut = z
  .object({
    uploadUrl: z.string().url(),
    storagePath: z.string().min(1),
    projectId: z.string().uuid(),
  })
  .strict();

export const UploadInitYtOut = z
  .object({
    projectId: z.string().uuid(),
  })
  .strict();

/** ---------- Clip Meta & Moderation ---------- */

export const ClipMetaUpdateInput = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(5000).optional(),
    hashtags: z
      .array(z.string().regex(/^#[\p{L}\p{N}_]+$/u, 'invalid hashtag'))
      .max(30)
      .optional(),
  })
  .strict();

export const ClipApproveInput = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

export const ClipRejectInput = z
  .object({
    reason: z.string().min(2).max(500),
  })
  .strict();

/** ---------- AI Clip Meta ---------- */

export const AIClipMetaRequest = z
  .object({
    transcript: z.string().min(1).max(200_000),
    titleHint: z.string().max(140).optional(),
    style: z.enum(['educational', 'storytime', 'debate', 'comedy', 'news']).optional(),
  })
  .strict();

export const AIClipMetaResponse = z
  .object({
    title: z.string().min(1).max(120),
    hashtags: z
      .array(z.string().regex(/^#[\p{L}\p{N}_]+$/u, 'invalid hashtag'))
      .max(15),
  })
  .strict();

/** ---------- Publish: YouTube ---------- */

export const PublishYouTubeInput = z
  .object({
    clipId: z.string().uuid(),
    visibility: z.enum(['public', 'unlisted', 'private']),
    scheduleAt: z.string().datetime({ offset: true }).optional(),
    accountId: z.string().min(1).optional(),
    titleOverride: z.string().max(120).optional(),
    descriptionOverride: z.string().max(5000).optional(),
    // Viral experiment fields (optional for V1)
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    connectedAccountIds: z.array(z.string().uuid()).optional(), // For multi-account posting
  })
  .strict();

/** ---------- Publish: TikTok ---------- */

export const PublishTikTokInput = z
  .object({
    clipId: z.string().uuid(),
    connectedAccountId: z.string().uuid().optional(), // Single account (backward compatibility)
    connectedAccountIds: z.array(z.string().uuid()).optional(), // Multi-account support
    caption: z.string().max(2200).optional(),
    privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIEND', 'SELF_ONLY']).optional(),
    // Optional viral experiment fields
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => data.connectedAccountId || (data.connectedAccountIds && data.connectedAccountIds.length > 0),
    {
      message: 'Either connectedAccountId or connectedAccountIds must be provided',
    },
  );

/** ---------- Schedules: cancel ---------- */

export const ScheduleCancelInput = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

/** ---------- Product/Dropshipper attach ---------- */

export const ProductAttachInput = z
  .object({
    clipId: z.string().uuid(),
    url: z.string().url(),
    utm: z
      .object({
        source: z.string().max(100).optional(),
        medium: z.string().max(100).optional(),
        campaign: z.string().max(100).optional(),
        content: z.string().max(100).optional(),
        term: z.string().max(100).optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

/** ---------- Types from schemas ---------- */


export * from './schemas/jobs';
export * from './schemas/dropshipping';
export * from './schemas/dropshippingCreative';
