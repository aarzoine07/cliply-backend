export class DeepgramTranscriber {
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
        if (!apiKey) {
            throw new Error('Deepgram API key is required to enable transcription');
        }
    }
    async transcribe(_localFile) {
        throw new Error('Deepgram transcriber not enabled in tests');
    }
}
