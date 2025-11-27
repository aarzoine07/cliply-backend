import { z } from "zod";
export var AuthErrorCode;
(function (AuthErrorCode) {
    AuthErrorCode["UNAUTHORIZED"] = "AUTH_UNAUTHORIZED";
    AuthErrorCode["FORBIDDEN"] = "AUTH_FORBIDDEN";
    AuthErrorCode["WORKSPACE_MISMATCH"] = "AUTH_WORKSPACE_MISMATCH";
    AuthErrorCode["MISSING_HEADER"] = "AUTH_MISSING_HEADER";
    AuthErrorCode["INTERNAL_ERROR"] = "AUTH_INTERNAL_ERROR";
})(AuthErrorCode || (AuthErrorCode = {}));
export const AuthContextSchema = z.object({
    user_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    plan: z.enum(["basic", "pro", "premium"]),
});
export function authErrorResponse(code, message, status) {
    return {
        ok: false,
        error: { code, message },
        status,
    };
}
