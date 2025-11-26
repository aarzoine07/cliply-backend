"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthContextSchema = exports.AuthErrorCode = void 0;
exports.authErrorResponse = authErrorResponse;
const zod_1 = require("zod");
var AuthErrorCode;
(function (AuthErrorCode) {
    AuthErrorCode["UNAUTHORIZED"] = "AUTH_UNAUTHORIZED";
    AuthErrorCode["FORBIDDEN"] = "AUTH_FORBIDDEN";
    AuthErrorCode["WORKSPACE_MISMATCH"] = "AUTH_WORKSPACE_MISMATCH";
    AuthErrorCode["MISSING_HEADER"] = "AUTH_MISSING_HEADER";
    AuthErrorCode["INTERNAL_ERROR"] = "AUTH_INTERNAL_ERROR";
})(AuthErrorCode || (exports.AuthErrorCode = AuthErrorCode = {}));
exports.AuthContextSchema = zod_1.z.object({
    user_id: zod_1.z.string().uuid(),
    workspace_id: zod_1.z.string().uuid(),
    plan: zod_1.z.enum(["basic", "pro", "premium"]),
});
function authErrorResponse(code, message, status) {
    return {
        ok: false,
        error: { code, message },
        status,
    };
}
//# sourceMappingURL=auth.js.map