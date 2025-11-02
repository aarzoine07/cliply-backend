/**
 * Debug script to test Sentry error capture from worker
 * Run with: npx tsx apps/worker/src/debug-sentry.ts
 */

import { initSentry, captureError } from "@cliply/shared/sentry";

async function testWorkerSentry(): Promise<void> {
  console.log("Initializing Sentry for worker test...");
  
  // Load environment variables
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  
  initSentry("worker");
  
  console.log("Capturing test error...");
  
  const testError = new Error("Sentry test error from worker");
  captureError(testError, {
    service: "worker",
    event: "debug_test",
    timestamp: new Date().toISOString(),
  });
  
  console.log("Test error captured, flushing...");
  
  // Import Sentry to access flush method
  const Sentry = await import("@sentry/node");
  await Sentry.flush(2000);
  
  console.log("✓ Test error sent to Sentry");
  console.log("Check dashboard: https://cliply.sentry.io/issues/?project=4510297116901376");
}

testWorkerSentry().catch((error) => {
  console.error("Failed to test Sentry:", error);
  process.exit(1);
});

