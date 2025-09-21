// Uniform success/error envelopes + tiny helpers

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; code: string; message: string; details?: unknown };

export function ok<T extends Record<string, unknown>>(body: T): Ok<T> {
  return { ok: true, ...body };
}

export function err(code: string, message: string, details?: unknown): Err {
  return { ok: false, code, message, details };
}

// Narrow type guard
export function isErr(x: unknown): x is Err {
  if (!x || typeof x !== 'object') {
    return false;
  }

  const candidate = x as { ok?: unknown };
  return candidate.ok === false;
}
