export interface AuditEventInput {
    workspace_id: string;
    actor_id: string | null;
    event_type: string;
    target_id?: string | null;
    payload?: Record<string, unknown>;
}
export interface AuditEventResult {
    ok: boolean;
    error?: {
        code: string;
        message: string;
    };
}
export declare function logAuditEvent(input: AuditEventInput): Promise<AuditEventResult>;
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
