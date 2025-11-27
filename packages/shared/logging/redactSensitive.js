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
];
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Deeply clones an object or array and replaces any sensitive key values
 * with a constant “[REDACTED]” string.
 */
export function redactSensitive(input) {
    if (Array.isArray(input)) {
        return input.map((value) => redactSensitive(value));
    }
    if (isObject(input)) {
        const result = {};
        for (const [key, value] of Object.entries(input)) {
            const lower = key.toLowerCase();
            if (SENSITIVE_KEYS.includes(lower)) {
                result[key] = "[REDACTED]";
            }
            else {
                result[key] = redactSensitive(value);
            }
        }
        return result;
    }
    return input;
}
/**
 * Example usage:
 * console.log(redactSensitive({ access_token: 'abc', user: { password: '123' } }));
 * → { access_token: "[REDACTED]", user: { password: "[REDACTED]" } }
 */
