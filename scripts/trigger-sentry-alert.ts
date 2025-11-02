#!/usr/bin/env tsx

/**
 * Trigger Sentry Alert Test
 * 
 * Sends 6 errors to Sentry within 1 minute to trigger alert rule.
 * Alert condition: ≥5 errors in 1 minute
 */

async function triggerAlertTest(): Promise<void> {
  console.log("\n🔥 Sentry Alert Trigger Test\n");
  console.log("Sending 6 errors to trigger alert (threshold: 5 errors/min)...\n");
  
  const errors: Array<{ type: string; status?: number }> = [];
  
  for (let i = 1; i <= 6; i++) {
    try {
      const response = await fetch("http://localhost:3000/api/debug-sentry", {
        method: "GET",
      });
      
      const data = await response.json();
      errors.push({ type: "web", status: response.status });
      
      console.log(`[${i}/6] ✓ Web error triggered (status: ${response.status})`);
    } catch (error) {
      console.error(`[${i}/6] ✗ Failed to trigger error:`, error instanceof Error ? error.message : error);
    }
    
    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log("\n" + "=".repeat(70));
  console.log(`\n✅ Sent ${errors.length} errors to Sentry`);
  console.log("\n📋 Next steps:");
  console.log("  1. Check dashboard: https://cliply.sentry.io/issues/?project=4510297116901376");
  console.log("  2. Verify 6 errors appear within ~30 seconds");
  console.log("  3. Wait for alert notification (email/Slack)");
  console.log("  4. Check Alerts → Alert History for triggered alert\n");
}

async function checkServerRunning(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:3000/api/health");
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const isRunning = await checkServerRunning();
  
  if (!isRunning) {
    console.error("\n❌ Web server not running on http://localhost:3000");
    console.error("\nStart the server first:");
    console.error("  pnpm dev\n");
    process.exit(1);
  }
  
  await triggerAlertTest();
}

main().catch((error) => {
  console.error("\n💥 Alert trigger test failed:", error);
  process.exit(1);
});

