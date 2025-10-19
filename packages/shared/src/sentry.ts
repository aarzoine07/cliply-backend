export function initSentry() {
  console.log("Sentry initialized (mock)");
}

export function captureError(error: unknown) {
  console.error("Captured error:", error);
}

export const log = (...args: any[]) => console.log(...args);
