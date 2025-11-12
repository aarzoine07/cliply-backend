export class WhisperTranscriber {
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is required to enable Whisper transcription');
        }
    }
    async transcribe(_localFile) {
        throw new Error('Whisper transcriber not enabled in tests');
    }
}
