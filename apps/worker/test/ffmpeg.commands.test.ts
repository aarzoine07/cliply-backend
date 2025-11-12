import { describe, expect, it } from "vitest";

import { buildRenderCommand } from "../src/services/ffmpeg/build-commands.js";

describe('buildRenderCommand', () => {
  it('builds expected args and filter graph', () => {
    const { args, filtergraph } = buildRenderCommand('C:/in.mp4', 'C:/out.mp4', {
      subtitlesPath: 'C:/captions/final.srt',
      clipStart: 1.5,
      clipEnd: 17.75,
      makeThumb: {
        outPath: 'C:/out/thumb.jpg',
        atSec: 9.25,
      },
    });

    expect(filtergraph).toContain('scale=1080:1920:force_original_aspect_ratio=cover');
    expect(filtergraph).toContain('boxblur=luma_radius=20:luma_power=1:chroma_radius=10');
    expect(filtergraph).toContain('overlay=(W-w)/2:(H-h)/2');
    expect(filtergraph).toContain("Fontname=Inter,Fontsize=36,Outline=2");
    expect(filtergraph).toContain("subtitles='C\\:/captions/final.srt'");
    expect(filtergraph).toContain('split=2');

    expect(args).toEqual(
      expect.arrayContaining([
        '-hide_banner',
        '-y',
        '-ss', '1.500',
        '-i', 'C:/in.mp4',
        '-t', '16.250',
        '-filter_complex', expect.any(String),
        '-map', expect.any(String),
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-r', '30',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        'C:/out.mp4',
        '-frames:v', '1',
        'C:/out/thumb.jpg',
      ])
    );
  });

  it('escapes Windows paths in subtitles filter', () => {
    const { filtergraph } = buildRenderCommand('input.mp4', 'output.mp4', {
      subtitlesPath: "C:/Users/tester's/subs.srt",
    });

    expect(filtergraph).toContain("subtitles='C\\:/Users/tester\\'s/subs.srt'");
  });
});
