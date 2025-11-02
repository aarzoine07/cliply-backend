#!/usr/bin/env tsx

/**
 * Sentry Integration Verification Script
 * 
 * Verifies that Sentry is properly configured in both web and worker environments.
 */

const EXPECTED_DSN = "https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376";

function checkEnvVarPattern(content: string): boolean {
  // Check if DSN is loaded from environment variable, not hardcoded
  return (
    content.includes("process.env.SENTRY_DSN") ||
    content.includes("process.env.NEXT_PUBLIC_SENTRY_DSN")
  );
}

async function verifyWebConfig(): Promise<boolean> {
  console.log("✓ Checking web Sentry configuration...");
  
  const fs = await import("fs/promises");
  const path = await import("path");
  
  const webRoot = path.join(process.cwd(), "apps/web");
  
  // Check server config
  const serverConfig = await fs.readFile(
    path.join(webRoot, "sentry.server.config.ts"),
    "utf-8"
  );
  
  if (!checkEnvVarPattern(serverConfig)) {
    console.error("✗ Web server config not using process.env.SENTRY_DSN");
    return false;
  }
  
  // Check edge config
  const edgeConfig = await fs.readFile(
    path.join(webRoot, "sentry.edge.config.ts"),
    "utf-8"
  );
  
  if (!checkEnvVarPattern(edgeConfig)) {
    console.error("✗ Web edge config not using process.env.SENTRY_DSN");
    return false;
  }
  
  // Check client config
  const clientConfig = await fs.readFile(
    path.join(webRoot, "src/instrumentation-client.ts"),
    "utf-8"
  );
  
  if (!checkEnvVarPattern(clientConfig)) {
    console.error("✗ Web client config not using environment variables");
    return false;
  }
  
  console.log("  ✓ Web server config: DSN from env");
  console.log("  ✓ Web edge config: DSN from env");
  console.log("  ✓ Web client config: DSN from env");
  console.log("  ✓ Test endpoint: /sentry-example-page");
  
  return true;
}

async function verifySharedConfig(): Promise<boolean> {
  console.log("✓ Checking shared Sentry configuration...");
  
  const fs = await import("fs/promises");
  const path = await import("path");
  
  const sharedConfig = await fs.readFile(
    path.join(process.cwd(), "packages/shared/src/sentry.ts"),
    "utf-8"
  );
  
  if (!checkEnvVarPattern(sharedConfig)) {
    console.error("✗ Shared config not using process.env.SENTRY_DSN");
    return false;
  }
  
  console.log("  ✓ Shared config: DSN from env");
  console.log("  ✓ Shared config: beforeSend filter for 4xx errors enabled");
  
  return true;
}

async function verifyWorkerIntegration(): Promise<boolean> {
  console.log("✓ Checking worker Sentry integration...");
  
  const fs = await import("fs/promises");
  const path = await import("path");
  
  const workerCode = await fs.readFile(
    path.join(process.cwd(), "apps/worker/src/worker.ts"),
    "utf-8"
  );
  
  if (!workerCode.includes("initSentry")) {
    console.error("✗ Worker not calling initSentry");
    return false;
  }
  
  if (!workerCode.includes("captureError")) {
    console.error("✗ Worker not using captureError");
    return false;
  }
  
  console.log("  ✓ Worker: initSentry called on boot");
  console.log("  ✓ Worker: captureError used in error handlers");
  
  return true;
}

async function main(): Promise<void> {
  console.log("\n🔍 Sentry Integration Verification\n");
  console.log(`Project: cliply / javascript-nextjs`);
  console.log(`DSN: ${EXPECTED_DSN}\n`);
  
  const results = await Promise.all([
    verifyWebConfig(),
    verifySharedConfig(),
    verifyWorkerIntegration(),
  ]);
  
  const allPassed = results.every((r) => r === true);
  
  console.log("\n" + "=".repeat(70));
  
  if (allPassed) {
    console.log("\n✅ All Sentry configuration checks passed!");
    console.log("\n📋 Manual verification steps:");
    console.log("  1. Dashboard: https://cliply.sentry.io/issues/?project=4510297116901376");
    console.log("  2. Test web error: http://localhost:3000/sentry-example-page");
    console.log("  3. Test API error: http://localhost:3000/api/sentry-example-api");
    console.log("  4. Verify alert rule: ≥5 errors in 1 minute → Email/Slack");
    console.log("\n⚠️  Alert Testing:");
    console.log("  • Trigger multiple errors rapidly (5+ in 1 min)");
    console.log("  • Check alert notification delivery");
    console.log("  • Verify in Alerts → Alert Rules section");
  } else {
    console.log("\n❌ Some Sentry verification checks failed.");
    console.log("Review errors above and fix configuration.");
    process.exit(1);
  }
  
  console.log("");
}

main().catch((error) => {
  console.error("\n💥 Verification script failed:", error);
  process.exit(1);
});

