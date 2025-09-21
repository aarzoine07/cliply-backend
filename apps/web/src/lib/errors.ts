export interface HttpErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
  expose?: boolean;
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  expose: boolean;

  constructor(status: number, message: string, codeOrOptions?: string | HttpErrorOptions, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;

    if (typeof codeOrOptions === 'string') {
      this.code = codeOrOptions;
      this.details = details;
      this.expose = status < 500;
    } else {
      const options = codeOrOptions ?? {};
      this.code = options.code ?? 'error';
      this.details = options.details ?? options.cause ?? details;
      this.expose = options.expose ?? status < 500;
    }
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
