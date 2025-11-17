export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  id: string;
  workspace_id: string;

  // REAL DB COLUMN — this is the correct field
  kind: string;

  // 'type' column in DB exists but is unused — keep optional for safety
  type?: string | null;

  payload: Record<string, any>;
  status: JobStatus;

  attempts: number;

  last_error?: string | null;

  next_run_at: string;

  created_at: string;
  updated_at: string;
}


