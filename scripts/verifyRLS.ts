import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AccessLevel = "anon" | "user" | "service";

interface TableResult {
  table: string;
  anon: string;
  user: string;
  service: string;
}

const TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "connected_accounts",
  "subscriptions",
  "events_audit",
  "dmca_reports",
] as const;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN;

function ensureEnv(name: string, value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

ensureEnv("SUPABASE_URL", SUPABASE_URL);
ensureEnv("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY);
ensureEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
ensureEnv("USER_ACCESS_TOKEN", USER_ACCESS_TOKEN);

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${USER_ACCESS_TOKEN}` } },
});
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function describeError(error: unknown): string {
  if (!error) return "OK";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "Unknown error";
}

async function testSelect(client: SupabaseClient, table: string): Promise<string> {
  const { error } = await client.from(table).select("*").limit(1);
  if (!error) return "PASS";
  const msg = describeError(error);
  if (/permission|not authorized|unauthorized/i.test(msg)) return "BLOCKED";
  return `ERR: ${msg}`;
}

async function verifyTable(table: string): Promise<TableResult> {
  const [anon, user, service] = await Promise.all([
    testSelect(anonClient, table),
    testSelect(userClient, table),
    testSelect(serviceClient, table),
  ]);

  return { table, anon, user, service };
}

function summarize(results: TableResult[]): void {
  const rows = results.map((r) => ({
    Table: r.table,
    Anon: r.anon,
    User: r.user,
    Service: r.service,
  }));

  console.log("\nRLS Verification Summary");
  console.table(rows);
}

async function main(): Promise<void> {
  console.log("Starting RLS verification...");
  const results: TableResult[] = [];

  for (const table of TABLES) {
    try {
      results.push(await verifyTable(table));
    } catch (error) {
      const msg = describeError(error);
      results.push({
        table,
        anon: "ERROR",
        user: "ERROR",
        service: `ERROR: ${msg}`,
      });
    }
  }

  summarize(results);
}

main().catch((error) => {
  console.error("verifyRLS failed:", error);
  process.exitCode = 1;
});
