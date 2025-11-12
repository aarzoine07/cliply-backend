import { describe, expect, it, vi } from 'vitest';

import { getTranscriber } from '../src/services/transcriber/index.js';
import { afterEach } from "vitest";

describe('stub transcriber', () => {
  const originalKey = process.env.DEEPGRAM_API_KEY;

  afterEach(() => {
    process.env.DEEPGRAM_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('produces deterministic transcript output', async () => {
    delete process.env.DEEPGRAM_API_KEY;

    const transcriber = getTranscriber();
    const result = await transcriber.transcribe('local-file.wav');

    expect(result.srt.trim().length).toBeGreaterThan(0);
    expect(result.srt).toMatch(/Wow/);
    expect(result.srt).toMatch(/secret/i);
    expect(result.srt).toMatch(/How to/);

    const json = result.json as { segments?: Array<Record<string, unknown>> };
    expect(Array.isArray(json.segments)).toBe(true);
    expect(json.segments).toHaveLength(8);
    const first = json.segments?.[0];
    expect(first).toMatchObject({ text: expect.stringContaining('Wow') });
  });

  it('throws when deepgram key present', () => {
    process.env.DEEPGRAM_API_KEY = 'test';
    expect(() => getTranscriber()).toThrowError('Deepgram disabled in tests');
  });
});
