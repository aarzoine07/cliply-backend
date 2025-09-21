/** Domain types shared across services */

export type UUID = string; // validate via schema guards when needed
export type ISODateString = string; // e.g., 2025-01-01T12:00:00Z

export type JobKind =
  | 'TRANSCRIBE'
  | 'HIGHLIGHT_DETECT'
  | 'CLIP_RENDER'
  | 'THUMBNAIL_GEN'
  | 'PUBLISH_YOUTUBE'
  | 'ANALYTICS_INGEST';

export type ProjectStatus = 'queued' | 'processing' | 'ready' | 'error';

export type ClipStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'rendering'
  | 'ready'
  | 'published'
  | 'failed';

export type IdempotencyState = 'pending' | 'completed' | 'failed';

export interface IdempotencyRecord {
  key: string;
  status: IdempotencyState;
  /** RFC 3339 timestamp strings */
  createdAt: ISODateString;
  expiresAt?: ISODateString;
  /** Optional request/response hashes for replay safety */
  requestHash?: string;
  responseHash?: string;
}

// Legacy aliases retained for compatibility
export type WorkspaceId = string;
export type ProjectId = string;
export type ClipId = string;
