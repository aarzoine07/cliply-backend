import { z } from "zod";
import type { ResolvedPlan } from "../billing/planResolution";

export type PlanName = "basic" | "pro" | "premium";

export interface AuthContext {
  user_id: string;
  workspace_id: string;
  // plan is now the full ResolvedPlan (features? any for test/prod parity)
  plan: ResolvedPlan & { features?: any };
  isAuthenticated: boolean;
  planId?: string; // for compatibility if needed
  // For backwards compatibility - these are always true when context is returned
  userId?: string;
  workspaceId?: string;
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
  plan: z.enum(["basic", "pro", "premium"]),
});

export function authErrorResponse(code: AuthErrorCode, message: string, status: number) {
  return {
    ok: false as const,
    error: { code, message },
    status,
  };
}
