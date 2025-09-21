import type { NextApiRequest, NextApiResponse } from 'next';

import { HttpError } from './errors';
import { logger } from './logger';

export type JsonOk<T = Record<string, unknown>> = { ok: true } & T;
export type JsonErr = { ok: false; code: string; message: string; details?: unknown };

export function ok<T extends Record<string, unknown> = Record<string, unknown>>(data?: T): JsonOk<T> {
  return { ok: true, ...(data ?? ({} as T)) };
}

export function err(code: string, message: string, details?: unknown): JsonErr {
  return { ok: false, code, message, details };
}

export function handler(
  fn: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        logger.warn('http_error', {
          status: error.status,
          code: error.code,
        });
        if (!res.headersSent) {
          res
            .status(error.status)
            .json(err(error.code, error.expose ? error.message : 'Something went wrong', error.details));
        }
        return;
      }

      logger.error('unhandled_error', { message: (error as Error)?.message ?? 'unknown' });
      if (!res.headersSent) {
        res.status(500).json(err('internal_error', 'Something went wrong'));
      }
    }
  };
}
