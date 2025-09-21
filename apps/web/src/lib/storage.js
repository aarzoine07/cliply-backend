import { getEnv } from "@/lib/env";
import { getAdminClient } from "@/lib/supabase";
import { BUCKET_VIDEOS, SIGNED_URL_TTL_SEC } from "@cliply/shared";
const ensuredBuckets = new Set();
async function ensureBucket(admin, bucket) {
    if (ensuredBuckets.has(bucket))
        return;
    const { data, error } = await admin.storage.getBucket(bucket);
    if (error && error.status !== 404) {
        throw error;
    }
    if (!data) {
        const { error: createError } = await admin.storage.createBucket(bucket, { public: false });
        if (createError && !(createError.message || '').match(/already exists/i)) {
            throw createError;
        }
    }
    ensuredBuckets.add(bucket);
}
async function parseError(response) {
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : { status: response.status };
    }
    catch {
        return { status: response.status };
    }
}
export async function getSignedUploadUrl(storageKey, ttlSec = SIGNED_URL_TTL_SEC, bucket = BUCKET_VIDEOS) {
    const admin = getAdminClient();
    await ensureBucket(admin, bucket);
    const env = getEnv();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
    }
    const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
    const key = storageKey.replace(/^\/+/, '');
    const requestUrl = new URL(`${baseUrl}/storage/v1/object/upload/sign/${bucket}/${key}`);
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: ttlSec }),
    });
    if (!response.ok) {
        const details = await parseError(response);
        throw new Error(`failed_to_create_signed_upload_url: ${JSON.stringify(details)}`);
    }
    const { url } = await response.json();
    if (!url) {
        throw new Error('failed_to_parse_signed_upload_response');
    }
    return `${baseUrl}/storage/v1${url}`;
}
