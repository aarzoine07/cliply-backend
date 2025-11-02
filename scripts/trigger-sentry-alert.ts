// scripts/trigger-sentry-alert.ts
import fetch from "node-fetch";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

async function main() {
  console.log(`\n🚀 Triggering 6 Sentry errors via ${SERVER_URL}/api/debug-sentry\n`);

  for (let i = 1; i <= 6; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/api/debug-sentry`);
      const text = await res.text();
      console.log(`[${i}/6] ✓ Web error triggered (${res.status})`);
    } catch (err) {
      console.error(`[${i}/6] ❌ Failed:`, err);
    }
  }

  console.log(`\n✅ Sent 6 errors to Sentry\n`);
  console.log("⏳ Wait 1 minute, then check your Sentry Alert History tab.");
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
});
