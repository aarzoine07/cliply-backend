export type LogBase = {
  service: 'api' | 'worker';
  route?: string;
  jobId?: number | string;
  userId?: string;
  workspaceId?: string;
  projectId?: string;
  clipId?: string;
  idempotencyKey?: string;
};

export function log(entry: LogBase & Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  } catch {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), service: 'api', msg: 'log_error' }),
    );
  }
}
