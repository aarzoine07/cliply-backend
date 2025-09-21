import { describe, it, expect } from 'vitest';

import { EXTENSION_MIME_MAP } from '../../packages/shared/src/constants';
import {
  UploadInitInput,
  UploadInitFileInput,
  UploadInitYouTubeInput,
} from '../../packages/shared/src/schemas';

describe('UploadInitInput schema', () => {
  it('accepts valid file input', () => {
    const good = {
      source: 'file' as const,
      filename: 'demo.mp4',
      size: 1024,
      mime: EXTENSION_MIME_MAP['.mp4'],
    };

    const parsed = UploadInitInput.parse(good);
    expect(parsed).toEqual(good);
  });

  it('rejects file when mime does not match extension', () => {
    const bad = {
      source: 'file' as const,
      filename: 'demo.mov',
      size: 1024,
      mime: EXTENSION_MIME_MAP['.mp4'],
    };

    expect(() => UploadInitInput.parse(bad)).toThrowError();
  });

  it('accepts valid youtube input', () => {
    const yt = {
      source: 'youtube' as const,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    };

    const parsed = UploadInitInput.parse(yt);
    expect(parsed).toEqual(yt);
  });

  it('rejects youtube input without url', () => {
    const bad = { source: 'youtube' as const } as unknown;
    expect(() => UploadInitYouTubeInput.parse(bad)).toThrowError();
  });

  it('rejects file with invalid filename characters', () => {
    const bad = {
      source: 'file' as const,
      filename: 'bad|name.mp4',
      size: 1,
      mime: EXTENSION_MIME_MAP['.mp4'],
    };

    expect(() => UploadInitFileInput.parse(bad)).toThrowError();
  });
});