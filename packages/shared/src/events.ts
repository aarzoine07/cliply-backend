/** Basic event-name registry used across services */
export type EventName =
  | 'JOB_ENQUEUED'
  | 'JOB_STARTED'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'CLIP_APPROVED'
  | 'CLIP_REJECTED'
  | 'CLIP_PUBLISHED';

export const eventsList: EventName[] = [
  'JOB_ENQUEUED',
  'JOB_STARTED',
  'JOB_COMPLETED',
  'JOB_FAILED',
  'CLIP_APPROVED',
  'CLIP_REJECTED',
  'CLIP_PUBLISHED',
];
