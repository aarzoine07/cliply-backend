// apps/web/src/lib/errors.ts
export class HttpError extends Error {
  status: number;
  body?: unknown;
  code?: string;

  constructor(status: number, message: string, body?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = code;
  }
}
