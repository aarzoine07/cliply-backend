export type LogService = "web" | "worker" | "cron" | "oauth" | "stripe";

export interface LogEvent {
  service: LogService;
  event: string;
  workspaceId?: string;
  jobId?: string;
  projectId?: string;
  clipId?: string;
  meta?: Record<string, unknown>;
}

