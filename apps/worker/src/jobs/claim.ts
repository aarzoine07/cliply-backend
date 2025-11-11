import * as db from '../db.js';

export interface ClaimOptions {
  workerId?: string;
  types?: string[];
  workspaceId?: string;
}

export interface ClaimedJob {
  id: string | number;
  kind: string;
  status: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  worker_id?: string;
  workspace_id?: string;
  run_after?: string | null;
  created_at?: string;
  updated_at?: string;
  error?: unknown;
  last_heartbeat?: string | null;
}

type AdminDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: ClaimedJob | null; error: unknown }>;
};

export async function claimNextJob(workerIdOrOpts?: string | ClaimOptions): Promise<ClaimedJob | null> {
  const options: ClaimOptions =
    typeof workerIdOrOpts === 'string'
      ? { workerId: workerIdOrOpts }
      : workerIdOrOpts
        ? { ...workerIdOrOpts }
        : {};
  const workerId = options.workerId;
  if (!workerId) {
    return null;
  }

  const maybeGetAdminDb = (db as { getAdminDb?: () => AdminDb }).getAdminDb;
  if (!maybeGetAdminDb) {
    return null;
  }

  const adminDb = maybeGetAdminDb();
  const params: Record<string, unknown> = { p_worker_id: workerId };
  if (options.types && options.types.length > 0) {
    params.p_types = options.types;
  }
  if (options.workspaceId) {
    params.p_workspace_id = options.workspaceId;
  }

  const { data, error } = await adminDb.rpc('claim_job', params);
  if (error || !data) {
    return null;
  }

  return data as ClaimedJob;
}
