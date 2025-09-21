export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Extra = Record<string, unknown>;

const REDACT_KEYS = [/key/i, /secret/i, /token/i, /authorization/i, /password/i];

function shouldRedact(key: string): boolean {
  return REDACT_KEYS.some((pattern) => pattern.test(key));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedact(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }

  return value;
}

export function log(level: Level, msg: string, extra: Extra = {}): void {
  try {
    const safeExtra = redact(extra);
    const payload =
      safeExtra && typeof safeExtra === 'object' && !Array.isArray(safeExtra)
        ? (safeExtra as Record<string, unknown>)
        : {};

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: 'api',
        level,
        msg,
        ...payload,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: 'api',
        level: 'error',
        msg: 'log_failed',
        error: (error as Error)?.message ?? 'unknown',
      }),
    );
  }
}

export const logger = {
  debug: (msg: string, extra?: Extra) => log('debug', msg, extra),
  info: (msg: string, extra?: Extra) => log('info', msg, extra),
  warn: (msg: string, extra?: Extra) => log('warn', msg, extra),
  error: (msg: string, extra?: Extra) => log('error', msg, extra),
};
