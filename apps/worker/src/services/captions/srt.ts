export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface ParsedCaptionSegment extends CaptionSegment {
  index: number;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const TIMESTAMP_REGEX = /^(\d{2}):(\d{2}):(\d{2}),(\d{1,3})$/;

function clampMilliseconds(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('timestamp must be finite');
  }
  return Math.max(0, Math.round(value));
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

export function secToTimestamp(sec: number): string {
  const totalMs = clampMilliseconds(sec * MS_PER_SECOND);
  const totalSeconds = Math.floor(totalMs / MS_PER_SECOND);

  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const milliseconds = totalMs % MS_PER_SECOND;

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
}

export function timestampToSec(timestamp: string): number {
  const match = timestamp.trim().match(TIMESTAMP_REGEX);
  if (!match) {
    throw new Error(`invalid SRT timestamp: ${timestamp}`);
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  const millis = Number.parseInt(match[4].padEnd(3, '0'), 10);

  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds + millis / MS_PER_SECOND;
}

export function toSrt(segments: CaptionSegment[]): string {
  if (segments.length === 0) {
    return '';
  }

  const blocks = segments.map((segment, index) => {
    if (segment.end < segment.start) {
      throw new Error('segment end must be >= start');
    }

    const start = secToTimestamp(segment.start);
    const end = secToTimestamp(segment.end);
    const text = segment.text.replace(/\r\n|\r/g, '\n');

    return `${index + 1}\n${start} --> ${end}\n${text}`;
  });

  return blocks.join('\n\n') + '\n';
}

export function parseSrt(srt: string): ParsedCaptionSegment[] {
  const normalized = srt.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length < 2) {
      throw new Error(`invalid SRT block: ${block}`);
    }

    const index = Number.parseInt(lines[0], 10);
    if (!Number.isInteger(index)) {
      throw new Error(`invalid SRT index: ${lines[0]}`);
    }

    const timing = lines[1].match(/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})$/);
    if (!timing) {
      throw new Error(`invalid SRT timing line: ${lines[1]}`);
    }

    const text = lines.slice(2).join('\n');
    return {
      index,
      start: timestampToSec(timing[1]),
      end: timestampToSec(timing[2]),
      text,
    };
  });
}
