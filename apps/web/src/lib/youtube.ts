export type YouTubeVisibility = 'public' | 'unlisted' | 'private';

export type YouTubeClient = {
  uploadShort: (
    filePath: string,
    opts: { title: string; description?: string; visibility: YouTubeVisibility },
  ) => Promise<{ videoId: string }>;
  scheduleShort: (videoId: string, whenIso: string) => Promise<{ scheduledAt: string }>;
};

export function createYouTubeClient(): YouTubeClient {
  return {
    async uploadShort(_filePath, _opts) {
      return { videoId: 'stub-video-id' };
    },
    async scheduleShort(_videoId, whenIso) {
      return { scheduledAt: whenIso };
    },
  };
}
