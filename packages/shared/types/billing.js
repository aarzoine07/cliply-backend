"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingErrorSchema = exports.BillingErrorCode = void 0;
exports.billingErrorResponse = billingErrorResponse;
const zod_1 = require("zod");
var BillingErrorCode;
(function (BillingErrorCode) {
    BillingErrorCode["PLAN_REQUIRED"] = "BILLING_PLAN_REQUIRED";
    BillingErrorCode["PLAN_LIMIT"] = "BILLING_PLAN_LIMIT";
    BillingErrorCode["RATE_LIMITED"] = "BILLING_RATE_LIMITED";
    BillingErrorCode["INVALID_SIGNATURE"] = "BILLING_INVALID_SIGNATURE";
    BillingErrorCode["WEBHOOK_ERROR"] = "BILLING_WEBHOOK_ERROR";
    BillingErrorCode["WORKSPACE_MISSING"] = "BILLING_WORKSPACE_MISSING";
    BillingErrorCode["INTERNAL_ERROR"] = "BILLING_INTERNAL_ERROR";
})(BillingErrorCode || (exports.BillingErrorCode = BillingErrorCode = {}));
exports.BillingErrorSchema = zod_1.z.nativeEnum(BillingErrorCode);
function billingErrorResponse(code, message, status) {
    return {
        ok: false,
        error: { code, message },
        status,
    };
}
//# sourceMappingURL=billing.js.map