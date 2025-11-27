import { z } from "zod";
export type PlanName = "basic" | "pro" | "premium";
export interface AuthContext {
    user_id: string;
    workspace_id: string;
    plan: PlanName;
    isAuthenticated: boolean;
    userId?: string;
    workspaceId?: string;
}
export declare enum AuthErrorCode {
    UNAUTHORIZED = "AUTH_UNAUTHORIZED",
    FORBIDDEN = "AUTH_FORBIDDEN",
    WORKSPACE_MISMATCH = "AUTH_WORKSPACE_MISMATCH",
    MISSING_HEADER = "AUTH_MISSING_HEADER",
    INTERNAL_ERROR = "AUTH_INTERNAL_ERROR"
}
export declare const AuthContextSchema: z.ZodObject<{
    user_id: z.ZodString;
    workspace_id: z.ZodString;
    plan: z.ZodEnum<{
        basic: "basic";
        pro: "pro";
        premium: "premium";
    }>;
}, z.core.$strip>;
export declare function authErrorResponse(code: AuthErrorCode, message: string, status: number): {
    ok: false;
    error: {
        code: AuthErrorCode;
        message: string;
    };
    status: number;
};
