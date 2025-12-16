import type { NextApiRequest, NextApiResponse } from "next";

import { captureException } from "@/lib/sentry";
import { HttpError } from "./errors";
import { logger } from "./logger";

// Success shape: both flat fields AND a nested `data` object
export type JsonOk<T = Record<string, unknown>> = {
  ok: true;
  data: T;
} & T;

// Error shape: flat `code` / `message` PLUS nested `error` object
export type JsonErr = {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function ok<T extends Record<string, unknown> = Record<string, unknown>>(
  data?: T,
): JsonOk<T> {
  const payload = (data ?? ({} as T));

  return {
    ok: true,
    // spread all fields so callers can read `jsonBody.clipId`, etc.
    ...(payload as Record<string, unknown>),
    // but also keep the original nested object for any callers using `data.*`
    data: payload,
  } as JsonOk<T>;
}

export function err(code: string, message: string, details?: unknown): JsonErr {
  const error = { code, message, details };

  return {
    ok: false,
    code,
    message,
    details,
    error,
  };
}

export function handler(
  fn: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        const code = error.code ?? "unknown_error";

        logger.warn("http_error", {
          status: error.status,
          code,
        });

        if (!res.headersSent) {
          const message =
            (error as any).expose ?? true ? error.message : "Something went wrong";
          const details = (error as any).details;

          res.status(error.status).json(err(code, message, details));
        }

        return;
      }

      logger.error("unhandled_error", {
        message: (error as Error)?.message ?? "unknown",
      });

      captureException(error, {
        route: req.url,
        method: req.method,
      });

      if (!res.headersSent) {
        res.status(500).json(err("internal_error", "Something went wrong"));
      }
    }
  };
}

