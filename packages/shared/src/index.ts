// ─────────────────────────────────────────────
// Core module exports
// ─────────────────────────────────────────────
export * from "./constants";
export * from "./env";
export * from "./errors";
export * from "./events";
export * from "./guards";
export * from "./http";
export * from "./logging";
export * from "./schemas";
export * from "./status";
export * from "./types";

// ─────────────────────────────────────────────
// Canonical JobKind source of truth
// ─────────────────────────────────────────────
export * from "./job-kinds";
export type { JobKind } from "./job-kinds";

// ─────────────────────────────────────────────
// Upload schemas
// ─────────────────────────────────────────────
export {
  EXTENSION_MIME_MAP,
  getExtension,
  MAX_UPLOAD_SIZE_BYTES,
  UploadInitInputSchema,
  UploadInitResponseSchema,
} from "./schemas/upload";

// ─────────────────────────────────────────────
// Crypto
// ─────────────────────────────────────────────
export * from "./crypto/encryptedSecretEnvelope";

// ─────────────────────────────────────────────
// Billing modules
// ─────────────────────────────────────────────
export * from "../billing/checkRateLimit";
export * from "../billing/planGate";
export * from "../billing/planMatrix";
export * from "../billing/planResolution";
export * from "../billing/rateLimitConfig";
export * from "../billing/stripePlanMap";
export * from "../billing/usageTracker";

// ─────────────────────────────────────────────
// Logging modules (full)
// ─────────────────────────────────────────────
export * from "../logging/auditLogger";
export * from "../logging/logger";
export * from "../logging/redactSensitive";
export * from "./observability/logging";

// ─────────────────────────────────────────────
// Readiness
// ─────────────────────────────────────────────
export * from "./readiness/backendReadiness";
export * from "./health/readyChecks";

// ─────────────────────────────────────────────
// Auth & Supabase Types
// ─────────────────────────────────────────────
export * from "./auth/context";
export * from "./types/supabase";
export * from "../types/auth";
export * from "../types/billing";
export * from "../types/rateLimit";

// ─────────────────────────────────────────────
// Database Types & Accessors
// ─────────────────────────────────────────────
export * from "./db/connected-account";
export * from "./db/connected-account-access";

// ─────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────
export * from "./services/tiktokAuth";
export * from "./services/youtubeAuth";

// ─────────────────────────────────────────────
// Sentry
// ─────────────────────────────────────────────
export { captureError, initSentry } from "./sentry";


