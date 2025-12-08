/**
 * Pipeline stage model for Machine Engine v1.
 * 
 * Represents the progress of a project through the processing pipeline.
 * Stages are monotonic - they only advance forward and never regress.
 * 
 * Stage progression:
 * UPLOADED → TRANSCRIBED → CLIPS_GENERATED → RENDERED → PUBLISHED
 */

export type ProjectPipelineStage =
  | 'UPLOADED'
  | 'TRANSCRIBED'
  | 'CLIPS_GENERATED'
  | 'RENDERED'
  | 'PUBLISHED';

/**
 * Stage order for comparison purposes.
 * Lower index = earlier stage.
 */
const STAGE_ORDER: ProjectPipelineStage[] = [
  'UPLOADED',
  'TRANSCRIBED',
  'CLIPS_GENERATED',
  'RENDERED',
  'PUBLISHED',
];

/**
 * Gets the numeric order of a stage (for comparison).
 * Returns -1 for unknown stages.
 */
function getStageOrder(stage: string | null | undefined): number {
  if (!stage) return -1;
  const index = STAGE_ORDER.indexOf(stage as ProjectPipelineStage);
  return index >= 0 ? index : -1;
}

/**
 * Checks if the current stage is at or beyond the target stage.
 * 
 * @param current - Current pipeline stage (may be null/undefined for new projects)
 * @param target - Target stage to check against
 * @returns true if current stage is at or beyond target
 * 
 * @example
 * isStageAtLeast('TRANSCRIBED', 'TRANSCRIBED') // true
 * isStageAtLeast('RENDERED', 'TRANSCRIBED') // true
 * isStageAtLeast('TRANSCRIBED', 'RENDERED') // false
 * isStageAtLeast(null, 'UPLOADED') // false (treats null as before UPLOADED)
 */
export function isStageAtLeast(
  current: string | null | undefined,
  target: ProjectPipelineStage,
): boolean {
  const currentOrder = getStageOrder(current);
  const targetOrder = getStageOrder(target);
  
  // If current is unknown/null, it's not at least the target (unless target is UPLOADED)
  if (currentOrder < 0) {
    return target === 'UPLOADED';
  }
  
  return currentOrder >= targetOrder;
}

/**
 * Gets the next stage after the current one.
 * Returns null if already at the final stage or if current is unknown.
 * 
 * @param current - Current pipeline stage
 * @returns Next stage, or null if at final stage or unknown
 * 
 * @example
 * nextStageAfter('UPLOADED') // 'TRANSCRIBED'
 * nextStageAfter('TRANSCRIBED') // 'CLIPS_GENERATED'
 * nextStageAfter('PUBLISHED') // null
 * nextStageAfter(null) // 'TRANSCRIBED' (treats null as UPLOADED)
 */
export function nextStageAfter(
  current: string | null | undefined,
): ProjectPipelineStage | null {
  const currentOrder = getStageOrder(current);
  
  // If current is null/unknown, next stage is TRANSCRIBED (after UPLOADED)
  if (currentOrder < 0) {
    return 'TRANSCRIBED';
  }
  
  const nextOrder = currentOrder + 1;
  if (nextOrder >= STAGE_ORDER.length) {
    return null; // Already at final stage
  }
  
  return STAGE_ORDER[nextOrder];
}

/**
 * Gets the default stage for new projects.
 */
export function getDefaultStage(): ProjectPipelineStage {
  return 'UPLOADED';
}

/**
 * Validates that a stage string is a valid ProjectPipelineStage.
 */
export function isValidStage(stage: string | null | undefined): stage is ProjectPipelineStage {
  if (!stage) return false;
  return STAGE_ORDER.includes(stage as ProjectPipelineStage);
}

/**
 * Determines if a pipeline should skip work based on current stage.
 * This is a convenience wrapper around isStageAtLeast for clearer intent.
 * 
 * @param currentStage - Current pipeline stage from DB (may be null)
 * @param requiredStage - Stage that must be completed for work to be skipped
 * @returns true if work should be skipped (stage already at or beyond required)
 * 
 * @example
 * // Transcribe pipeline checks if transcription already done
 * if (shouldSkipStage(projectStage, 'TRANSCRIBED')) {
 *   logger.info('pipeline_stage_skipped', ...);
 *   return;
 * }
 * 
 * // Render pipeline checks if rendering already done
 * if (shouldSkipStage(projectStage, 'RENDERED')) {
 *   logger.info('pipeline_stage_skipped', ...);
 *   return;
 * }
 */
export function shouldSkipStage(
  currentStage: string | null | undefined,
  requiredStage: ProjectPipelineStage,
): boolean {
  return isStageAtLeast(currentStage, requiredStage);
}

