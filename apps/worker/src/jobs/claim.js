import * as db from '../db';
export async function claimNextJob(workerIdOrOpts) {
    const options = typeof workerIdOrOpts === 'string'
        ? { workerId: workerIdOrOpts }
        : workerIdOrOpts
            ? { ...workerIdOrOpts }
            : {};
    const workerId = options.workerId;
    if (!workerId) {
        return null;
    }
    const maybeGetAdminDb = db.getAdminDb;
    if (!maybeGetAdminDb) {
        return null;
    }
    const adminDb = maybeGetAdminDb();
    const params = { p_worker_id: workerId };
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
    return data;
}
