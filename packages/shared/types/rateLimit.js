"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitErrorCode = void 0;
exports.rateLimitErrorResponse = rateLimitErrorResponse;
/**
 * Standardized error handling for rate-limit violations.
 */
var RateLimitErrorCode;
(function (RateLimitErrorCode) {
    RateLimitErrorCode["RATE_LIMIT_EXCEEDED"] = "BILLING_RATE_LIMITED";
    RateLimitErrorCode["RATE_LIMIT_INTERNAL_ERROR"] = "BILLING_INTERNAL_ERROR";
})(RateLimitErrorCode || (exports.RateLimitErrorCode = RateLimitErrorCode = {}));
/**
 * Helper for consistent API error responses.
 */
function rateLimitErrorResponse(err) {
    return {
        ok: false,
        error: {
            code: err.code,
            message: err.message,
        },
    };
}
//# sourceMappingURL=rateLimit.js.map