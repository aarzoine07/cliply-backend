export class HttpError extends Error {
  public readonly status: number;
  public readonly expose: boolean;

  constructor(status: number, message: string, options?: { expose?: boolean; cause?: unknown }) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.expose = options?.expose ?? status < 500;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
