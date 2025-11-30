/**
 * Canonical pipeline stage enum used by the Machine.
 * Represents fine-grained processing stages beyond DB status.
 */
export type PipelineStage =
  | 'uploaded'
  | 'transcribing'
  | 'analyzing'
  | 'clips_proposed'
  | 'rendering'
  | 'rendered'
  | 'posted'
  | 'failed';

/**
 * Helper to set pipeline_stage on a Project or Clip entity.
 * Assumes entity has a pipeline_stage field (added via migration).
 */
export function setPipelineStage(
  entity: { pipeline_stage?: string | null },
  stage: PipelineStage
): void {
  entity.pipeline_stage = stage;
}

/**
 * Type guard to check if a string is a valid PipelineStage
 */
export function isValidPipelineStage(value: unknown): value is PipelineStage {
  return (
    typeof value === 'string' &&
    [
      'uploaded',
      'transcribing',
      'analyzing',
      'clips_proposed',
      'rendering',
      'rendered',
      'posted',
      'failed',
    ].includes(value)
  );
}

