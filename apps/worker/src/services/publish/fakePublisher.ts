/**
 * Fake Publisher for E2E Testing
 * 
 * Simulates TikTok and YouTube publishing without making real API calls.
 * Used in engine E2E tests to verify pipeline flow without external dependencies.
 */

export interface FakePublishRecord {
  channel: 'tiktok' | 'youtube';
  clipId: string;
  projectId: string;
  workspaceId: string;
  videoId?: string;
  caption?: string;
  timestamp: string;
}

// In-memory store for published records
const published: FakePublishRecord[] = [];

/**
 * Get all published records (for test assertions)
 */
export function getPublishedRecords(): FakePublishRecord[] {
  return [...published];
}

/**
 * Clear all published records (for test cleanup)
 */
export function clearPublishedRecords(): void {
  published.length = 0;
}

/**
 * Fake TikTok publisher client
 * Mimics the interface of the real TikTokClient
 */
export class FakeTikTokClient {
  constructor(config: { accessToken: string }) {
    // No-op constructor, just for API compatibility
  }

  async uploadVideo(params: {
    filePath: string;
    caption?: string;
    privacyLevel?: string;
  }): Promise<{ videoId: string; rawResponse: unknown }> {
    // Simulate successful upload
    const videoId = `fake-tiktok-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    return {
      videoId,
      rawResponse: {
        data: {
          share_id: videoId,
          publish_id: videoId,
        },
        error: {
          code: 'ok',
          message: '',
        },
      },
    };
  }
}

/**
 * Record a fake TikTok publish (called by pipeline)
 */
export function recordTikTokPublish(params: {
  clipId: string;
  projectId: string;
  workspaceId: string;
  videoId: string;
  caption?: string;
}): void {
  published.push({
    channel: 'tiktok',
    clipId: params.clipId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    videoId: params.videoId,
    caption: params.caption,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Record a fake YouTube publish (called by pipeline)
 */
export function recordYouTubePublish(params: {
  clipId: string;
  projectId: string;
  workspaceId: string;
  videoId: string;
  caption?: string;
}): void {
  published.push({
    channel: 'youtube',
    clipId: params.clipId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    videoId: params.videoId,
    caption: params.caption,
    timestamp: new Date().toISOString(),
  });
}

