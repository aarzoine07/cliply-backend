import type { Database } from "../types/supabase";

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
export type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];
export type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];

export type JobEventRow = Database["public"]["Tables"]["job_events"]["Row"];
export type JobEventInsert = Database["public"]["Tables"]["job_events"]["Insert"];

export type IdempotencyKeyRow = Database["public"]["Tables"]["idempotency_keys"]["Row"];
export type IdempotencyKeyInsert = Database["public"]["Tables"]["idempotency_keys"]["Insert"];

export type JobKind =
  | "TRANSCRIBE"
  | "HIGHLIGHT_DETECT"
  | "CLIP_RENDER"
  | "PUBLISH_TIKTOK";

export type JobState = "queued" | "running" | "done" | "error";

export interface JobPayload extends Record<string, unknown> {}
export interface JobResult extends Record<string, unknown> {}

export interface EnrichedJob extends JobRow {
  events?: JobEventRow[];
}
