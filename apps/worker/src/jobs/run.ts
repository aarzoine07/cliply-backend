import * as db from '../db';
import { pipelineTranscribeStub } from '../pipelines/transcribe';
import type { ClaimedJob } from './claim';

type JobsTable = {
  update: (values: Record<string, unknown>) => { eq: (column: string, value: unknown) => unknown | Promise<unknown> };
};

type AdminDb = {
  from: (table: string) => JobsTable;
};

type JobHandler = (job: ClaimedJob) => unknown | Promise<unknown>;

const handlers: Record<string, JobHandler> = {
  TRANSCRIBE: pipelineTranscribeStub as unknown as JobHandler,
};

export async function runJob(job: ClaimedJob): Promise<void> {
  const handler = handlers[job.kind];
  if (!handler) {
    return;
  }

  const maybeGetAdminDb = (db as { getAdminDb?: () => AdminDb }).getAdminDb;
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
