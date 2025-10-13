export interface RenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  preset?: string;
  audioBitrateK?: number;
  fontFile?: string;
  subtitlesPath?: string;
  loudnorm?: {
    I: number;
    TP: number;
    LRA: number;
  };
  makeThumb?: {
    outPath: string;
    atSec?: number;
  };
  clipStart?: number;
  clipEnd?: number;
}

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_CRF = 20;
const DEFAULT_PRESET = 'veryfast';
const DEFAULT_AUDIO_BITRATE = 160;
const DEFAULT_LOUDNORM = { I: -16, TP: -1.5, LRA: 11 };

export function buildRenderCommand(inputPath: string, outPath: string, opts: RenderOptions): {
  args: string[];
  filtergraph: string;
} {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const fps = opts.fps ?? DEFAULT_FPS;
  const crf = opts.crf ?? DEFAULT_CRF;
  const preset = opts.preset ?? DEFAULT_PRESET;
  const audioBitrate = opts.audioBitrateK ?? DEFAULT_AUDIO_BITRATE;
  const loudnorm = opts.loudnorm ?? DEFAULT_LOUDNORM;

  const filterParts: string[] = [];
  filterParts.push(
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=cover,` +
      'boxblur=luma_radius=20:luma_power=1:chroma_radius=10[bg]'
  );
  filterParts.push(`[0:v]scale=-1:${height}:force_original_aspect_ratio=decrease[fg]`);
  filterParts.push('[bg][fg]overlay=(W-w)/2:(H-h)/2[base]');

  let renderLabel = '[base]';
  let thumbLabel: string | null = null;

  if (opts.subtitlesPath) {
    const escaped = escapeSubtitlesPath(opts.subtitlesPath);
    const style = `Fontname=Inter,Fontsize=36,Outline=2`;
    filterParts.push(`${renderLabel}subtitles=${escaped}:force_style='${style}'[subbed]`);
    renderLabel = '[subbed]';
  }

  if (opts.makeThumb) {
    filterParts.push(`${renderLabel}split=2[render_src][thumb_src]`);
    renderLabel = '[render_src]';
    const thumbAt = Math.max(0, opts.makeThumb.atSec ?? 0);
    filterParts.push(
      `[thumb_src]trim=start=${thumbAt.toFixed(3)}:duration=0.05,setpts=PTS-STARTPTS[thumb]`
    );
    thumbLabel = '[thumb]';
  }

  const filtergraph = filterParts.join(';');
  const args: string[] = ['-hide_banner', '-y'];

  if (typeof opts.clipStart === 'number') {
    args.push('-ss', formatTime(opts.clipStart));
  }

  args.push('-i', inputPath);

  if (typeof opts.clipEnd === 'number') {
    const baseline = typeof opts.clipStart === 'number' ? opts.clipStart : 0;
    const duration = Math.max(0, opts.clipEnd - baseline);
    if (duration > 0) {
      args.push('-t', formatTime(duration));
    }
  }

  args.push(
    '-filter_complex',
    filtergraph,
    '-map',
    renderLabel,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-r',
    String(fps),
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    `${audioBitrate}k`,
    '-af',
    buildLoudnorm(loudnorm),
    outPath
  );

  if (thumbLabel && opts.makeThumb) {
    args.push('-map', thumbLabel, '-frames:v', '1', opts.makeThumb.outPath);
  }

  return { args, filtergraph };
}

function buildLoudnorm(values: { I: number; TP: number; LRA: number }): string {
  return `loudnorm=I=${values.I}:TP=${values.TP}:LRA=${values.LRA}`;
}

function escapeSubtitlesPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const escapedColon = normalized.replace(/:/g, '\\:');
  const escapedQuotes = escapedColon.replace(/'/g, "\\'");
  return `'${escapedQuotes}'`;
}

function formatTime(value: number): string {
  return value.toFixed(3);
}
