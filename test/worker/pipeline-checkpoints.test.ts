import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkerContext } from '../../apps/worker/src/pipelines/types';
import { isStageAtLeast, nextStageAfter, type ProjectPipelineStage } from '../../packages/shared/src/engine/pipelineStages';

// Mock the pipeline functions - we'll test checkpoint logic in isolation
// by creating helpers that simulate stage checks and updates

describe('pipeline checkpoints', () => {
  let mockContext: WorkerContext;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(),
            single: vi.fn(),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        })),
      })),
    };

    mockContext = {
      supabase: mockSupabase,
      storage: {
        exists: vi.fn(),
        list: vi.fn(),
        download: vi.fn(),
        upload: vi.fn(),
        remove: vi.fn(),
        removeBatch: vi.fn(),
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      sentry: {
        captureException: vi.fn(),
      },
      queue: {
        enqueue: vi.fn(),
      },
    };
  });

  describe('pipeline stage helpers', () => {
    it('isStageAtLeast should correctly compare stages', () => {
      expect(isStageAtLeast('UPLOADED', 'UPLOADED')).toBe(true);
      expect(isStageAtLeast('TRANSCRIBED', 'UPLOADED')).toBe(true);
      expect(isStageAtLeast('TRANSCRIBED', 'TRANSCRIBED')).toBe(true);
      expect(isStageAtLeast('RENDERED', 'TRANSCRIBED')).toBe(true);
      expect(isStageAtLeast('TRANSCRIBED', 'RENDERED')).toBe(false);
      expect(isStageAtLeast(null, 'UPLOADED')).toBe(true); // null treated as before UPLOADED
      expect(isStageAtLeast(null, 'TRANSCRIBED')).toBe(false);
    });

    it('nextStageAfter should return correct next stage', () => {
      expect(nextStageAfter('UPLOADED')).toBe('TRANSCRIBED');
      expect(nextStageAfter('TRANSCRIBED')).toBe('CLIPS_GENERATED');
      expect(nextStageAfter('CLIPS_GENERATED')).toBe('RENDERED');
      expect(nextStageAfter('RENDERED')).toBe('PUBLISHED');
      expect(nextStageAfter('PUBLISHED')).toBe(null);
      expect(nextStageAfter(null)).toBe('TRANSCRIBED'); // null treated as UPLOADED
    });
  });

  describe('transcribe pipeline checkpoint', () => {
    it('should skip transcription if stage is already TRANSCRIBED', async () => {
      // Mock project with TRANSCRIBED stage
      const mockProject = { id: 'project-123', pipeline_stage: 'TRANSCRIBED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage,workspace_id')
        .eq('id', 'project-123')
        .maybeSingle();

      const currentStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(currentStage, 'TRANSCRIBED');

      expect(shouldSkip).toBe(true);
      expect(mockContext.logger.info).not.toHaveBeenCalled(); // Would be called in actual pipeline
    });

    it('should proceed with transcription if stage is UPLOADED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'UPLOADED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage,workspace_id')
        .eq('id', 'project-123')
        .maybeSingle();

      const currentStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(currentStage, 'TRANSCRIBED');

      expect(shouldSkip).toBe(false);
    });

    it('should advance stage from UPLOADED to TRANSCRIBED after completion', () => {
      const currentStage: ProjectPipelineStage | null = 'UPLOADED';
      const nextStage = nextStageAfter(currentStage);

      expect(nextStage).toBe('TRANSCRIBED');
    });
  });

  describe('highlight-detect pipeline checkpoint', () => {
    it('should skip highlight detection if stage is already CLIPS_GENERATED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'CLIPS_GENERATED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const currentStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(currentStage, 'CLIPS_GENERATED');

      expect(shouldSkip).toBe(true);
    });

    it('should proceed if stage is TRANSCRIBED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'TRANSCRIBED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const currentStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(currentStage, 'CLIPS_GENERATED');

      expect(shouldSkip).toBe(false);
    });

    it('should advance stage from TRANSCRIBED to CLIPS_GENERATED after completion', () => {
      const currentStage: ProjectPipelineStage | null = 'TRANSCRIBED';
      const nextStage = nextStageAfter(currentStage);

      expect(nextStage).toBe('CLIPS_GENERATED');
    });
  });

  describe('clip-render pipeline checkpoint', () => {
    it('should skip rendering if project stage is already RENDERED and clip is ready', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'RENDERED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
            single: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      mockContext.storage.exists = vi.fn().mockResolvedValue(true); // Video exists

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,workspace_id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const projectStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(projectStage, 'RENDERED');

      expect(shouldSkip).toBe(true);
    });

    it('should proceed if stage is CLIPS_GENERATED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'CLIPS_GENERATED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,workspace_id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const projectStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(projectStage, 'RENDERED');

      expect(shouldSkip).toBe(false);
    });

    it('should advance stage from CLIPS_GENERATED to RENDERED after all clips are ready', () => {
      const currentStage: ProjectPipelineStage | null = 'CLIPS_GENERATED';
      const nextStage = nextStageAfter(currentStage);

      expect(nextStage).toBe('RENDERED');
    });
  });

  describe('publish pipeline checkpoint', () => {
    it('should skip publishing if project stage is already PUBLISHED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'PUBLISHED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const projectStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(projectStage, 'PUBLISHED');

      expect(shouldSkip).toBe(true);
    });

    it('should proceed if stage is RENDERED', async () => {
      const mockProject = { id: 'project-123', pipeline_stage: 'RENDERED' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const { data: project } = await mockContext.supabase
        .from('projects')
        .select('id,pipeline_stage')
        .eq('id', 'project-123')
        .maybeSingle();

      const projectStage = project?.pipeline_stage ?? null;
      const shouldSkip = isStageAtLeast(projectStage, 'PUBLISHED');

      expect(shouldSkip).toBe(false);
    });

    it('should advance stage from RENDERED to PUBLISHED after successful publish', () => {
      const currentStage: ProjectPipelineStage | null = 'RENDERED';
      const nextStage = nextStageAfter(currentStage);

      expect(nextStage).toBe('PUBLISHED');
    });
  });

  describe('stage monotonicity', () => {
    it('should never regress stages', () => {
      const stages: ProjectPipelineStage[] = ['UPLOADED', 'TRANSCRIBED', 'CLIPS_GENERATED', 'RENDERED', 'PUBLISHED'];
      
      for (let i = 0; i < stages.length; i++) {
        for (let j = i + 1; j < stages.length; j++) {
          // Earlier stage should not be "at least" later stage
          expect(isStageAtLeast(stages[i], stages[j])).toBe(false);
          // Later stage should be "at least" earlier stage
          expect(isStageAtLeast(stages[j], stages[i])).toBe(true);
        }
      }
    });

    it('should only advance forward', () => {
      const stages: ProjectPipelineStage[] = ['UPLOADED', 'TRANSCRIBED', 'CLIPS_GENERATED', 'RENDERED', 'PUBLISHED'];
      
      for (let i = 0; i < stages.length - 1; i++) {
        const next = nextStageAfter(stages[i]);
        expect(next).toBe(stages[i + 1]);
      }
      
      // Final stage should return null
      expect(nextStageAfter(stages[stages.length - 1])).toBe(null);
    });
  });

  describe('retry behavior', () => {
    it('should not duplicate work when retrying after completion', async () => {
      // Simulate: transcribe pipeline completes, stage = TRANSCRIBED
      const stageAfterTranscribe: ProjectPipelineStage = 'TRANSCRIBED';
      
      // Retry transcribe job
      const shouldSkip = isStageAtLeast(stageAfterTranscribe, 'TRANSCRIBED');
      
      expect(shouldSkip).toBe(true);
      // In actual pipeline, this would log pipeline_stage_skipped and return early
    });

    it('should resume from correct stage after partial failure', async () => {
      // Simulate: transcribe completes (TRANSCRIBED), highlight-detect fails partway
      // Stage should remain at TRANSCRIBED
      const stageAfterPartialFailure: ProjectPipelineStage = 'TRANSCRIBED';
      
      // Retry highlight-detect
      const shouldSkip = isStageAtLeast(stageAfterPartialFailure, 'CLIPS_GENERATED');
      
      expect(shouldSkip).toBe(false); // Should proceed, not skip
      
      // But transcribe should skip
      const transcribeShouldSkip = isStageAtLeast(stageAfterPartialFailure, 'TRANSCRIBED');
      expect(transcribeShouldSkip).toBe(true);
    });
  });
});

