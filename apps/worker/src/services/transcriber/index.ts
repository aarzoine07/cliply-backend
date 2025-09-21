export type TranscriberKind = 'deepgram' | 'whisper';
export function makeTranscriberStub(): TranscriberKind {
  return 'deepgram';
}

