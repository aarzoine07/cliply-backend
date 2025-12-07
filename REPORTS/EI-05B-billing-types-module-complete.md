# EI-05B: Billing Types Module — COMPLETE

**Date:** 2025-12-07  
**Task:** Create canonical shared billing types module to restore web build  
**Status:** ✅ Complete

---

## Summary

Successfully created a canonical billing types module at `packages/shared/src/types/billing.ts` that provides `BillingErrorCode` and `billingErrorResponse()` helper, fixing the web build error. Also updated `AuthContext` and `AuthErrorCode` to support modern usage patterns in web code.

### Original Problem

```
apps/web/src/lib/withRateLimit.ts
import { BillingErrorCode, billingErrorResponse } from "@cliply/shared/types/billing";
// → Cannot find module '@cliply/shared/types/billing'
```

After the EI-04B cleanup (removal of `packages/shared/billing/`), the web app build failed because:
1. `types/billing` module didn't exist in the new canonical `src/` structure
2. `AuthContext` was missing explicit fields for snake_case properties (`user_id`, `workspace_id`, `plan`)
3. `AuthErrorCode` was only a type union, but needed to be a value/object for property access

---

## Files Created

### 1. **`packages/shared/src/types/billing.ts`** (70 lines)

New canonical billing types module providing:

- **`BillingErrorCode` const object:**
  - `RATE_LIMITED`
  - `WORKSPACE_MISSING`
  - `BILLING_PLAN_REQUIRED`
  - `BILLING_PLAN_LIMIT`
  - `INVALID_SIGNATURE`
  - `INTERNAL_ERROR`

- **`BillingErrorCode` type:** Derived from const for type checking

- **`BillingErrorResponse` interface:**
  - `ok: false`
  - `code: BillingErrorCode`
  - `message: string`
  - `status?: number`

- **`billingErrorResponse()` helper:**
  - Pure function that builds error payloads
  - Matches pattern from `authErrorResponse`
  - Supports optional custom messages and status codes

**Pattern:** Mirrors the auth types module for consistency, using const objects for both runtime property access and compile-time type checking.

---

## Files Modified

### 2. **`packages/shared/src/types/auth.ts`**

**Changes:**
- Converted `AuthErrorCode` from pure type union to **const object + type**
- Added new error codes: `UNAUTHORIZED`, `MISSING_HEADER`, `WORKSPACE_MISMATCH`
- Updated `AuthContext` interface to include:
  - Snake case fields: `user_id`, `workspace_id`
  - Plan field: `plan?: PlanName`
  - Auth flag: `isAuthenticated?: boolean`

**Before:**
```typescript
export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | (string & {});
```

**After:**
```typescript
export const AuthErrorCode = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",
  MISSING_WORKSPACE: "MISSING_WORKSPACE",
  MISSING_HEADER: "MISSING_HEADER",
  WORKSPACE_MISMATCH: "WORKSPACE_MISMATCH",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode] | (string & {});
```

**Rationale:** Web code uses `AuthErrorCode.MISSING_HEADER` as a property access, which requires a value/object, not just a type.

### 3. **`packages/shared/src/auth/context.ts`**

**Changes:**
- Updated import path: `../../types/auth.js` → `../types/auth.js`
- Fixed re-export path: `../../types/auth` → `../types/auth`

**Rationale:** With the removal of legacy `packages/shared/billing/`, imports needed to reflect the new canonical `src/` structure.

### 4. **`packages/shared/src/billing/checkRateLimit.ts`**

**Changes:**
- Updated import path: `../../types/billing` → `../types/billing`

### 5. **`packages/shared/src/index.ts`**

**Changes:**
- Updated export paths from `../types/*` to `./types/*`
- Removed non-existent `./types/rateLimit` export

**Before:**
```typescript
export * from "../types/auth";
export * from "../types/billing";
export * from "../types/rateLimit";
```

**After:**
```typescript
export * from "./types/auth";
export * from "./types/billing";
```

### 6. **`apps/web/src/pages/api/oauth/google/start.ts`**

**Changes:**
- Added `userId` validation check before calling `checkRateLimit`

**Rationale:** TypeScript correctly identified that `userId` could be `undefined`, but `checkRateLimit` requires `string`. Added guard clause for type safety.

### 7. **`apps/web/src/pages/api/oauth/tiktok/start.ts`**

**Changes:**
- Added `userId` validation check before calling `checkRateLimit`

**Same rationale as above.**

---

## Key Patterns Established

### 1. **Error Code Pattern**

Both `AuthErrorCode` and `BillingErrorCode` now use the **const object + derived type** pattern:

```typescript
export const ErrorCode = {
  CODE_ONE: "CODE_ONE",
  CODE_TWO: "CODE_TWO",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});
```

**Benefits:**
- Property access works: `ErrorCode.CODE_ONE`
- Type checking works: `foo: ErrorCode`
- Future extensibility: `| (string & {})` allows additional codes without breaking consumers

### 2. **Error Response Helper Pattern**

Both `authErrorResponse` and `billingErrorResponse` follow a consistent shape:

```typescript
export interface ErrorResponse {
  ok: false;
  code: ErrorCode;
  message: string;
  status?: number;
  [key: string]: unknown; // allow extra metadata
}

export function errorResponse(
  code: ErrorCode,
  message?: string,
  status?: number,
): ErrorResponse {
  return {
    ok: false,
    code,
    message: message ?? DEFAULT_MESSAGES[code] ?? "Default error message",
    ...(status ? { status } : {}),
  };
}
```

**Benefits:**
- Pure function (no side effects)
- Serializable payloads for JSON responses
- Supports both default and custom messages
- Optional HTTP status code

### 3. **AuthContext Pattern**

Updated to support both snake_case (from DB/backend) and camelCase (for frontend/API compatibility):

```typescript
export interface AuthContext {
  // Snake case (from getAuthContext return)
  user_id?: string | null;
  workspace_id?: string | null;
  // Camel case (aliases)
  userId?: string | null;
  workspaceId?: string | null;
  plan?: PlanName;
  email?: string | null;
  roles?: string[];
  isAuthenticated?: boolean;
  // Extensible
  [key: string]: unknown;
}
```

**Benefits:**
- Supports both naming conventions
- Explicit typing for commonly used fields
- Still extensible via index signature

---

## Build & Test Results

### Build Status

✅ **Full monorepo build succeeds:**

```bash
pnpm build
# packages/shared build ✅ (2.6s)
# apps/web build       ✅ (35.6s)
# apps/worker build    ✅ (4.1s)
```

**Before this fix:**
- Web build failed with `Cannot find module '@cliply/shared/types/billing'`

**After this fix:**
- All packages build successfully
- No type errors
- Web routes compile and bundle correctly

### Regression Tests

✅ **All engine & shared tests pass:**

| Test Suite                       | Status | Tests  |
|----------------------------------|--------|--------|
| `postingGuard.test.ts`           | ✅ Pass | 30/30  |
| `clipCount.test.ts`              | ✅ Pass | 30/30  |
| `clipOverlap.test.ts`            | ✅ Pass | 26/26  |
| `usageTracker.posts.test.ts`     | ✅ Pass | 14/14  |
| **Total**                        | ✅ Pass | 100/100|

---

## Integration with Prior Work

This task builds on the EI-04B cleanup:

| Task    | Goal                                      | Result                                     |
|---------|-------------------------------------------|--------------------------------------------|
| EI-04B  | Remove legacy `packages/shared/billing/`  | ✅ Canonical `src/billing/` established    |
| EI-05B  | Restore web build after cleanup           | ✅ Canonical `src/types/billing.ts` added  |

**Cumulative Impact:**
1. ✅ Single source of truth for billing code (`src/billing/`)
2. ✅ Single source of truth for billing types (`src/types/billing.ts`)
3. ✅ Web build restored without reintroducing legacy structure
4. ✅ Type safety improved in web routes (added userId checks)
5. ✅ Error code patterns unified across auth and billing

---

## Acceptance Criteria

| Criterion                                          | Status |
|----------------------------------------------------|--------|
| `packages/shared/src/types/billing.ts` exists      | ✅      |
| `BillingErrorCode` const + type defined            | ✅      |
| `billingErrorResponse()` helper implemented        | ✅      |
| Web import resolves: `@cliply/shared/types/billing`| ✅      |
| `pnpm build` succeeds (shared, worker, web)        | ✅      |
| All engine tests pass (100/100)                    | ✅      |
| No reintroduction of legacy `billing/` directory   | ✅      |
| Patterns consistent with `types/auth.ts`           | ✅      |

**All acceptance criteria met! ✅**

---

## Summary of Changes

**Created:**
- `packages/shared/src/types/billing.ts` (70 lines)

**Modified (shared package):**
- `packages/shared/src/types/auth.ts` (updated AuthErrorCode pattern, expanded AuthContext)
- `packages/shared/src/auth/context.ts` (fixed import paths)
- `packages/shared/src/billing/checkRateLimit.ts` (fixed import path)
- `packages/shared/src/index.ts` (fixed export paths)

**Modified (web package):**
- `apps/web/src/pages/api/oauth/google/start.ts` (added userId validation)
- `apps/web/src/pages/api/oauth/tiktok/start.ts` (added userId validation)

**Files Deleted:**
- None (EI-04B already removed legacy `billing/`)

---

## Next Steps

With web build restored and all tests passing, engine internals work can continue with a stable, green baseline.

**Recommended next task:** ME-I-06 or other engine internals tasks as prioritized by the user.

---

**End of Report**

