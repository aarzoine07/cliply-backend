import { randomUUID } from "node:crypto";

import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { getSignedUploadUrl } from "@/lib/storage";

const InputSchema = z
  .object({
    fileName: z.string().min(1, "fileName is required"),
    fileType: z.string().min(1, "fileType is required"),
  })
  .strict();

type SuccessResponse = {
  url: string;
  path: string;
};

type ErrorResponse = {
  error: string;
  details?: unknown;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<SuccessResponse | ErrorResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const validation = InputSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: "invalid_request",
      details: validation.error.format(),
    });
  }

  try {
    const { fileName, fileType } = validation.data;
    const storageKey = buildStorageKey(fileName, fileType);
    const url = await getSignedUploadUrl(storageKey, 600, "clips");

    return res.status(200).json({
      url,
      path: storageKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return res.status(500).json({
      error: "failed_to_create_upload",
      details: message,
    });
  }
}

function buildStorageKey(fileName: string, fileType: string): string {
  const trimmed = fileName.trim();
  const extension = extractExtension(trimmed) || guessExtension(fileType);
  const baseName = extension ? trimmed.slice(0, trimmed.length - extension.length) : trimmed;
  const safeBase = baseName.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const safeExtension = extension.toLowerCase();
  const uniqueId = randomUUID();
  const normalizedBase = safeBase || "upload";

  return `uploads/${normalizedBase}-${uniqueId}${safeExtension}`;
}

function extractExtension(value: string): string {
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1 || lastDot === value.length - 1) return "";
  return value.slice(lastDot);
}

function guessExtension(fileType: string): string {
  return MIME_EXTENSION_MAP[fileType.toLowerCase()] ?? "";
}
