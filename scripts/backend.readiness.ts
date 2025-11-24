import "dotenv/config";
import { buildBackendReadinessReport } from "../packages/shared/src/readiness/backendReadiness";
import { verifyWorkerEnvironment } from "../apps/worker/src/lib/envCheck";

async function main() {
  try {
    // Get worker environment status (includes binary checks)
    const workerStatus = await verifyWorkerEnvironment();

    // Build full readiness report including worker checks
    const report = await buildBackendReadinessReport({
      includeWorkerEnv: true,
      workerStatus,
    });

    // Print JSON to stdout (machine-readable)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));

    // Exit with code 0 if OK, non-zero otherwise
    if (!report.ok) {
      process.exit(1);
    }
  } catch (error) {
    // Fatal error - print JSON error and exit non-zero
    const errorMessage = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ok: false,
        fatal: true,
        error: errorMessage,
      }),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ok: false,
      fatal: true,
      error: errorMessage,
    }),
  );
  process.exit(1);
});

