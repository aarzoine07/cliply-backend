/**
 * Standardized error handling for rate-limit violations.
 */
export var RateLimitErrorCode;
(function (RateLimitErrorCode) {
    RateLimitErrorCode["RATE_LIMIT_EXCEEDED"] = "BILLING_RATE_LIMITED";
    RateLimitErrorCode["RATE_LIMIT_INTERNAL_ERROR"] = "BILLING_INTERNAL_ERROR";
})(RateLimitErrorCode || (RateLimitErrorCode = {}));
/**
 * Helper for consistent API error responses.
 */
export function rateLimitErrorResponse(err) {
    return {
        ok: false,
        error: {
            code: err.code,
            message: err.message,
        },
    };
}
