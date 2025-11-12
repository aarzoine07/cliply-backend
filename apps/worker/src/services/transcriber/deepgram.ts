import { type TranscribeResult, type Transcriber } from './index.js';

export class DeepgramTranscriber implements Transcriber {
  constructor(private readonly apiKey: string | undefined) {
    if (!apiKey) {
      throw new Error('Deepgram API key is required to enable transcription');
    }
  }

  async transcribe(_localFile: string): Promise<TranscribeResult> {
    throw new Error('Deepgram transcriber not enabled in tests');
  }
}
