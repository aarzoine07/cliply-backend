import { getEnv } from "@cliply/shared/env";
import { HttpError } from "@/lib/errors";
import { getAdminClient } from "@/lib/supabase";
const ensuredBuckets = new Set();
export const DEFAULT_VIDEO_BUCKET = "videos";
export async function ensureBucketExists(bucketName = DEFAULT_VIDEO_BUCKET) {
    if (ensuredBuckets.has(bucketName))
        return;
    const admin = getAdminClient();
    if (!admin) {
        throw new HttpError(500, "supabase storage is not configured", { expose: false });
    }
    const { data, error } = await admin.storage.getBucket(bucketName);
    if (error && error.status !== 404) {
        throw new HttpError(500, "failed to inspect storage bucket", { cause: error, expose: false });
    }
    if (!data) {
        const { error: createError } = await admin.storage.createBucket(bucketName, {
            public: false,
        });
        if (createError) {
            throw new HttpError(500, "failed to prepare storage bucket", { cause: createError, expose: false });
        }
    }
    ensuredBuckets.add(bucketName);
}
export async function getSignedUploadUrl(storageKey, ttlSeconds = 600, bucketName = DEFAULT_VIDEO_BUCKET) {
    await ensureBucketExists(bucketName);
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new HttpError(500, "supabase storage is not configured", { expose: false });
    }
    const sanitizedKey = storageKey.replace(/^\/+/, "");
    const requestUrl = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/upload/sign/${bucketName}/${sanitizedKey}`);
    const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!response.ok) {
        const errorPayload = await safeReadError(response);
        throw new HttpError(500, "failed to create signed upload url", { cause: errorPayload, expose: false });
    }
    const { url } = (await response.json());
    if (!url) {
        throw new HttpError(500, "failed to parse signed upload response", { expose: false });
    }
    const signedUrl = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1${url}`);
    return signedUrl.toString();
}
async function safeReadError(response) {
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : { status: response.status };
    }
    catch {
        return { status: response.status };
    }
}
