import type { SupabaseClient } from "@supabase/supabase-js";

export interface LoggerLike {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface StorageAdapter {
  exists(bucket: string, path: string): Promise<boolean>;
  list(bucket: string, prefix: string): Promise<string[]>;
  download(bucket: string, path: string, destination: string): Promise<string>;
  upload(bucket: string, path: string, localFile: string, contentType?: string): Promise<void>;
}

export interface SentryAdapter {
  captureException(error: unknown, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void;
}

export interface QueueAdapter {
  enqueue(input: { type: string; payload: unknown; workspaceId: string; scheduledFor?: string | null }): Promise<void>;
}

export interface Job<TPayload> {
  id: string | number;
  type: string;
  workspaceId: string;
  payload: TPayload;
  attempts?: number;
  createdAt?: string;
}

export interface WorkerContext {
  supabase: SupabaseClient;
  storage: StorageAdapter;
  logger: LoggerLike;
  sentry: SentryAdapter;
  queue: QueueAdapter;
}

export type PipelineResult = void;
