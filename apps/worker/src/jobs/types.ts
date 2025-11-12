export type JobStatus = "pending" | "processing" | "failed" | "completed";

export interface JobRecord {
  id: string;
  workspace_id: string;
  type: string;
  payload: Record<string, any>;
  status: JobStatus;
  attempts: number;
  last_error?: string;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

