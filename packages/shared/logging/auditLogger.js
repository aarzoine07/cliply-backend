"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuditEvent = logAuditEvent;
const supabase_js_1 = require("@supabase/supabase-js");
const redactSensitive_1 = require("./redactSensitive");
const logger_1 = require("./logger");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured for audit logging.");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for audit logging.");
}
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});
async function logAuditEvent(input) {
    try {
        const redactedPayload = input.payload ? (0, redactSensitive_1.redactSensitive)(input.payload) : null;
        const { error } = await supabase.from("events_audit").insert({
            workspace_id: input.workspace_id,
            actor_id: input.actor_id,
            event_type: input.event_type,
            target_id: input.target_id ?? null,
            payload: redactedPayload,
            created_at: new Date().toISOString(),
        });
        if (error) {
            logger_1.logger.error("Failed to insert audit event", { workspace_id: input.workspace_id, event_type: input.event_type }, { error });
            return { ok: false, error: { code: "COMPLIANCE_INSERT_FAILED", message: error.message } };
        }
        logger_1.logger.info("Audit event recorded", { workspace_id: input.workspace_id, event_type: input.event_type }, redactedPayload ?? undefined);
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger_1.logger.error("Unexpected audit logger failure", { workspace_id: input.workspace_id, event_type: input.event_type }, { error: message });
        return { ok: false, error: { code: "COMPLIANCE_INTERNAL_ERROR", message } };
    }
}
/**
 * Example usage:
 * await logAuditEvent({
 *   workspace_id,
 *   actor_id: user_id,
 *   event_type: 'clip_created',
 *   target_id: clip_id,
 *   payload: { title, duration },
 * });
 */
//# sourceMappingURL=auditLogger.js.map