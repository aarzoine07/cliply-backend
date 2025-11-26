/**
 * Canonical JobKind union type.
 *
 * This is the single source of truth for all job kinds used across the codebase.
 * All pipelines, API routes, Zod schemas, job enqueue logic, and worker handlers
 * should import and use this type.
 *
 * IMPORTANT: This union MUST exactly match the jobs.kind CHECK constraint
 * defined in the database migrations (see: supabase/migrations/*_align_jobs_kind_check.sql).
 * When adding or removing job kinds, update both this file and the DB constraint.
 */

// Array of all valid job kinds (for Zod enum validation)
export const JOB_KINDS = [
  'TRANSCRIBE',
  'HIGHLIGHT_DETECT',
  'CLIP_RENDER',
  'THUMBNAIL_GEN',
  'YOUTUBE_DOWNLOAD',
  'PUBLISH_YOUTUBE',
  'PUBLISH_TIKTOK',
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

