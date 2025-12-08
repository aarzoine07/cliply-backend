/**
 * Video processing error classes for FFmpeg, YouTube downloads, and video validation.
 * These errors are used throughout the worker pipelines to provide structured error handling.
 */

export class VideoTooLongError extends Error {
  constructor(
    message: string,
    public readonly durationSeconds?: number,
    public readonly maxDurationSeconds?: number,
  ) {
    super(message);
    this.name = "VideoTooLongError";
  }
}

export class FfmpegTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs?: number,
    public readonly inputPath?: string,
  ) {
    super(message);
    this.name = "FfmpegTimeoutError";
  }
}

export class FfmpegExecutionError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number | null,
    public readonly signal?: NodeJS.Signals | null,
    public readonly inputPath?: string,
    public readonly outputPath?: string,
  ) {
    super(message);
    this.name = "FfmpegExecutionError";
  }
}

export class InvalidVideoUrlError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "InvalidVideoUrlError";
  }
}

export class DownloadFailedError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly source?: string,
  ) {
    super(message);
    this.name = "DownloadFailedError";
  }
}

export class UnsupportedFormatError extends Error {
  constructor(
    message: string,
    public readonly format?: string,
    public readonly codec?: string,
  ) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

