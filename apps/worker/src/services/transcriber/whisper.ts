import { type TranscribeResult, type Transcriber } from './index';

export class WhisperTranscriber implements Transcriber {
  constructor(private readonly apiKey: string | undefined) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required to enable Whisper transcription');
    }
  }

  async transcribe(_localFile: string): Promise<TranscribeResult> {
    throw new Error('Whisper transcriber not enabled in tests');
  }
}
