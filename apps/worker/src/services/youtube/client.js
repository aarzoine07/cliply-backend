import { randomUUID } from 'node:crypto';
export class YouTubeClient {
    accessToken;
    constructor(config) {
        const token = config.accessToken?.trim();
        if (!token) {
            throw new Error('YouTube access token is required');
        }
        this.accessToken = token;
    }
    async uploadShort(_params) {
        return { videoId: `dryrun_${randomUUID()}` };
    }
}
