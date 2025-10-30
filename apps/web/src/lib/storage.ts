import type { SupabaseClient } from "@supabase/supabase-js";

// With this:
const BUCKET_VIDEOS = "videos";
const SIGNED_URL_TTL_SEC = 60 * 5; // 5 minutes
import { getEnv } from "./env";
import { getAdminClient } from "./supabase";

const ensuredBuckets = new Set<string>();

async function ensureBucket(admin: SupabaseClient, bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;

  const { data, error } = await admin.storage.getBucket(bucket);
  if (error && (error as { status?: number }).status !== 404) {
    throw error;
  }

  if (!data) {
    const { error: createError } = await admin.storage.createBucket(bucket, { public: false });
    if (createError && !/already exists/i.test(createError.message ?? "")) {
      throw createError;
    }
  }

  ensuredBuckets.add(bucket);
}

async function parseError(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : { status: response.status };
  } catch {
    return { status: response.status };
  }
}

export async function getSignedUploadUrl(
  storageKey: string,
  ttlSec = SIGNED_URL_TTL_SEC,
  bucket = BUCKET_VIDEOS,
): Promise<string> {
  const admin = getAdminClient();
  await ensureBucket(admin, bucket);

  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  }

  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  const key = storageKey.replace(/^\/+/, "");
  const requestUrl = new URL(`${baseUrl}/storage/v1/object/upload/sign/${bucket}/${key}`);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: ttlSec }),
  });

  if (!response.ok) {
    const details = await parseError(response);
    throw new Error(`failed_to_create_signed_upload_url: ${JSON.stringify(details)}`);
  }

  const { url } = (await response.json()) as { url?: string };
  if (!url) {
    throw new Error("failed_to_parse_signed_upload_response");
  }

  return `${baseUrl}/storage/v1${url}`;
}
