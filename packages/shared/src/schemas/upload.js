import { z } from "zod";
const MAX_UPLOAD_BYTES = 2_147_483_648; // 2GB
export const EXTENSION_MIME_MAP = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
};
const allowedExtensions = Object.keys(EXTENSION_MIME_MAP);
export const UploadInitInputSchema = z
    .object({
    source: z.literal("file"),
    filename: z
        .string()
        .min(1, "filename is required")
        .max(255, "filename is too long")
        .regex(/^[^\\\\/:*?"<>|]+$/, "filename contains invalid characters"),
    size: z
        .number()
        .int("size must be an integer")
        .positive("size must be greater than zero")
        .max(MAX_UPLOAD_BYTES, "file too large"),
    mime: z.enum([
        "video/mp4",
        "video/quicktime",
        "video/x-matroska",
    ]),
})
    .strict()
    .superRefine((value, ctx) => {
    const extension = getExtension(value.filename);
    if (!extension || !allowedExtensions.includes(extension)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unsupported file extension",
            path: ["filename"],
        });
        return;
    }
    const expectedMime = EXTENSION_MIME_MAP[extension];
    if (expectedMime !== value.mime) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "mime type does not match file extension",
            path: ["mime"],
        });
    }
});
export const UploadInitResponseSchema = z
    .object({
    uploadUrl: z.string().url(),
    storagePath: z.string().min(1),
    projectId: z.string().uuid(),
})
    .strict();
export function getExtension(filename) {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex === -1)
        return undefined;
    const ext = filename.slice(dotIndex).toLowerCase();
    return allowedExtensions.includes(ext)
        ? ext
        : undefined;
}
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_BYTES;
