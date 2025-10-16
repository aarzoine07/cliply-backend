import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_ID = process.env.WORKSPACE_ID;
const FEATURE_NAME = process.env.FEATURE_NAME ?? "clip_render";

function ensureEnv(name: string, value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

ensureEnv("SUPABASE_URL", SUPABASE_URL);
ensureEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
ensureEnv("WORKSPACE_ID", WORKSPACE_ID);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRateLimitConfig(feature: string) {
  const { data, error } = await supabase
    .from("rate_limits")
    .select("tokens, capacity, refill_rate, last_refill_at, workspace_id, feature")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("feature", feature)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query rate_limits: ${error.message}`);
  }

  if (!data) {
    throw new Error(`No rate_limits row found for workspace ${WORKSPACE_ID} / feature ${feature}`);
  }

  return data;
}

async function consumeToken(feature: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_consume_token", {
    p_workspace_id: WORKSPACE_ID,
    p_feature: feature,
  });

  if (error) {
    console.error("RPC error:", error);
    return false;
  }

  return Boolean(data);
}

async function runCycle(feature: string) {
  console.log(`\nConsuming tokens for feature "${feature}"...`);
  let attempt = 0;
  while (true) {
    attempt += 1;
    const remaining = await consumeToken(feature);
    console.log(`Attempt ${attempt}: ${remaining ? "ALLOWED" : "BLOCKED"}`);
    if (!remaining) break;
  }
}

async function main() {
  console.log("Starting rate-limit diagnostic...");
  console.log(`Workspace: ${WORKSPACE_ID}`);
  console.log(`Feature: ${FEATURE_NAME}`);

  const config = await fetchRateLimitConfig(FEATURE_NAME);
  const refillMs = Math.max(1, Math.floor((3600 / Math.max(config.refill_rate, 1)) * 1000));

  console.log("Current bucket state:", config);

  await runCycle(FEATURE_NAME);

  console.log(`Waiting ${refillMs}ms for refill...`);
  await sleep(refillMs);

  await runCycle(FEATURE_NAME);

  console.log("Rate-limit diagnostic completed.");
}

main().catch((error) => {
  console.error("testRateLimit failed:", error);
  process.exitCode = 1;
});
