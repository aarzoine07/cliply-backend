import { randomUUID } from 'node:crypto';

export interface UploadShortParams {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'private';
}

export class YouTubeClient {
  private readonly accessToken: string;

  constructor(config: { accessToken: string }) {
    const token = config.accessToken?.trim();
    if (!token) {
      throw new Error('YouTube access token is required');
    }

    this.accessToken = token;
  }

  async uploadShort(_params: UploadShortParams): Promise<{ videoId: string }> {
    return { videoId: `dryrun_${randomUUID()}` };
  }
}
