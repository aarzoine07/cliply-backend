import { z } from "zod";

export type PlanName = "basic" | "growth" | "agency";

export interface AuthContext {
  user_id: string;
  workspace_id: string;
  plan: PlanName;
}

export enum AuthErrorCode {
  UNAUTHORIZED = "AUTH_UNAUTHORIZED",
  FORBIDDEN = "AUTH_FORBIDDEN",
  WORKSPACE_MISMATCH = "AUTH_WORKSPACE_MISMATCH",
  MISSING_HEADER = "AUTH_MISSING_HEADER",
  INTERNAL_ERROR = "AUTH_INTERNAL_ERROR",
}

export const AuthContextSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  plan: z.enum(["basic", "growth", "agency"]),
});

export function authErrorResponse(code: AuthErrorCode, message: string, status: number) {
  return {
    ok: false as const,
    error: { code, message },
    status,
  };
}
