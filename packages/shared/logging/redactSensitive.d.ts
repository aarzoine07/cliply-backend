/**
 * Sensitive key names to redact from logs and events.
 * The redactor matches case-insensitively and recursively replaces their values.
 */
export declare const SENSITIVE_KEYS: readonly ["access_token", "refresh_token", "api_key", "authorization", "secret", "password", "stripe_secret", "tiktok_token", "supabase_key", "service_role_key"];
/**
 * Deeply clones an object or array and replaces any sensitive key values
 * with a constant “[REDACTED]” string.
 */
export declare function redactSensitive<T>(input: T): T;
/**
 * Example usage:
 * console.log(redactSensitive({ access_token: 'abc', user: { password: '123' } }));
 * → { access_token: "[REDACTED]", user: { password: "[REDACTED]" } }
 */
