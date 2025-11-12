import * as db from '../db';
import { pipelineTranscribeStub } from '../pipelines/transcribe';
const handlers = {
    TRANSCRIBE: pipelineTranscribeStub,
};
export async function runJob(job) {
    const handler = handlers[job.kind];
    if (!handler) {
        return;
    }
    const maybeGetAdminDb = db.getAdminDb;
    await Promise.resolve(handler(job));
    if (!maybeGetAdminDb) {
        return;
    }
    const adminDb = maybeGetAdminDb();
    const jobsTable = adminDb.from ? adminDb.from('jobs') : undefined;
    const updater = jobsTable?.update({
        status: 'succeeded',
        worker_id: job.worker_id,
        last_heartbeat: new Date().toISOString(),
    });
    const eq = typeof updater?.eq === 'function' ? updater.eq : undefined;
    if (eq) {
        await Promise.resolve(eq('id', job.id));
    }
}
