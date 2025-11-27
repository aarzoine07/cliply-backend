/**
 * Project and Clip status constants and types.
 *
 * These values MUST match the DB CHECK constraints in:
 * - projects.status CHECK (status IN ('queued','processing','ready','error'))
 * - clips.status CHECK (status IN ('proposed','approved','rejected','rendering','ready','published','failed'))
 *
 * Used by API routes and worker pipelines for status validation and transitions.
 */

import type { ClipStatus, ProjectStatus } from './types';

export type { ClipStatus, ProjectStatus };

export const PROJECT_STATUSES: ProjectStatus[] = [
  'queued',
  'processing',
  'ready',
  'error',
];

export const CLIP_STATUSES: ClipStatus[] = [
  'proposed',
  'approved',
  'rejected',
  'rendering',
  'ready',
  'published',
  'failed',
];

