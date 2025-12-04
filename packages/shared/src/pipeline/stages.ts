// packages/shared/src/pipeline/stages.ts
// Temporary implementation for worker pipeline tracking.
// TODO: replace with real DB/event logging if needed.

export type PipelineName = 'CLIP_RENDER' | 'HIGHLIGHT_DETECT' | string;
export type PipelineStage =
  | 'INIT'
  | 'DOWNLOAD_SOURCE'
  | 'TRANSCRIBE'
  | 'HIGHLIGHT_DETECT'
  | 'RENDER'
  | 'UPLOAD'
  | 'COMPLETE'
  | string;

export interface PipelineStageContext {
  pipeline: PipelineName;
  stage: PipelineStage;
  jobId?: string;
  workspaceId?: string;
}

/**
 * Stub implementation used by worker pipelines.
 * It currently does nothing at runtime, but satisfies TypeScript and
 * can be wired to real logging/DB tracking later.
 */
export async function setPipelineStage(
  ctx: PipelineStageContext,
): Promise<void> {
  // eslint-disable-next-line no-console
  console.debug(
    '[pipeline] setPipelineStage stub called',
    JSON.stringify(ctx),
  );

  // No-op for now
  return;
}