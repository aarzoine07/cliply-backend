/**
 * Sensitive key names to redact from logs and events.
 * The redactor matches case-insensitively and recursively replaces their values.
 */
export const SENSITIVE_KEYS = [
  "access_token",
  "refresh_token",
  "api_key",
  "authorization",
  "secret",
  "password",
  "stripe_secret",
  "tiktok_token",
  "supabase_key",
  "service_role_key",
] as const;

type SensitiveKey = (typeof SENSITIVE_KEYS)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deeply clones an object or array and replaces any sensitive key values
 * with a constant “[REDACTED]” string.
 */
export function redactSensitive<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((value) => redactSensitive(value)) as unknown as T;
  }

  if (isObject(input)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const lower = key.toLowerCase() as SensitiveKey;
      if (SENSITIVE_KEYS.includes(lower)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactSensitive(value);
      }
    }
    return result as T;
  }

  return input;
}

/**
 * Example usage:
 * console.log(redactSensitive({ access_token: 'abc', user: { password: '123' } }));
 * → { access_token: "[REDACTED]", user: { password: "[REDACTED]" } }
 */
