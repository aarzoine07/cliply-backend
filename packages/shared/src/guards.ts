/** Narrowing helpers usable without Zod at call sites */

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isUUID(v: unknown): v is string {
  return isString(v) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function isISODate(v: unknown): v is string {
  return isString(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v);
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected variant: ${String(x)}`);
}