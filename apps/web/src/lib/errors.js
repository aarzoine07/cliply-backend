export class HttpError extends Error {
    status;
    expose;
    constructor(status, message, options) {
        super(message, options);
        this.name = "HttpError";
        this.status = status;
        this.expose = options?.expose ?? status < 500;
    }
}
export function isHttpError(error) {
    return error instanceof HttpError;
}
