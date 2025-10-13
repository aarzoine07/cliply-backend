import { z } from "zod";

export const TRANSCRIBE = z
  .object({
    projectId: z.string().uuid(),
    sourceExt: z.enum(["mp4", "mov", "mkv", "webm"]).optional(),
  })
  .strict();

export const HIGHLIGHT_DETECT = z
  .object({
    projectId: z.string().uuid(),
    maxClips: z.number().int().min(1).max(20).default(8),
    minGapSec: z.number().min(0).max(10).default(2),
    keywords: z.array(z.string()).default(["wow", "insane", "tip", "secret", "how to", "trick"]),
  })
  .strict();

export const CLIP_RENDER = z
  .object({
    clipId: z.string().uuid(),
  })
  .strict();

export const THUMBNAIL_GEN = z
  .object({
    clipId: z.string().uuid(),
    atSec: z.number().min(0).default(1),
  })
  .strict();

export const PUBLISH_YOUTUBE = z
  .object({
    clipId: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    visibility: z.enum(["public", "unlisted", "private"]).optional(),
  })
  .strict();
