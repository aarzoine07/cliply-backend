import * as Sentry from "@sentry/node";
import * as sharedLogging from "@cliply/shared/logging/logger";

export function logEvent(job_id: string, event: string, extra: Record<string, any> = {}): void {
  const entry = { level: "info", job_id, event, ts: new Date().toISOString(), ...extra };
  console.log(JSON.stringify(entry));

  Sentry.addBreadcrumb({
    category: "worker",
    message: `${event}`,
    data: { job_id, ...extra },
    level: "info",
  });
}

