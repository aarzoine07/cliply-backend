export interface BackoffOptions {
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  jitter?: number;
}

export function computeBackoffMs(attempts: number, opts: BackoffOptions = {}): number {
  const base = Math.max(1, Math.floor(opts.baseMs ?? 2000));
  const factor = opts.factor ?? 2;
  const maxMs = Math.max(base, Math.floor(opts.maxMs ?? 60_000));
  const normalizedAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const exp = normalizedAttempts - 1;
  const raw = base * Math.pow(factor, exp);
  return Math.min(raw, maxMs);
}
