// test/worker/jobs.flow.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();

const job = {
  id: 1,
  workspace_id: 'ws-123',
  kind: 'TRANSCRIBE' as const,
  status: 'running' as const,
  run_after: null,
  attempts: 1,
  max_attempts: 3,
  payload: {},
  error: null,
  worker_id: 'worker-1',
  last_heartbeat: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

vi.mock('../../apps/worker/src/db', () => ({
  getAdminDb: () => ({
    rpc: rpcMock,
    from: () => ({
      update: updateMock,
    }),
  }),
}));

vi.mock('../../apps/worker/src/pipelines/transcribe', () => ({
  pipelineTranscribeStub: vi.fn().mockResolvedValue(undefined),
}));

import { computeBackoffMs } from '../../apps/worker/src/jobs/backoff';
import { claimNextJob } from '../../apps/worker/src/jobs/claim';
import { runJob } from '../../apps/worker/src/jobs/run';

describe('worker job flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: job, error: null });
    eqMock.mockResolvedValue({ data: job, error: null });
    updateMock.mockReturnValue({ eq: eqMock });
  });

  it('claims a job via RPC', async () => {
    const result = await claimNextJob('worker-1');
    expect(result).toBeTruthy();
    expect(result?.status).toBe('running');
    expect(rpcMock).toHaveBeenCalledWith('claim_job', { p_worker_id: 'worker-1' });
  });

  it('runs a job successfully', async () => {
    const result = await claimNextJob('worker-1');
    await expect(runJob(result!)).resolves.toBeUndefined();
    expect(updateMock).toHaveBeenCalled();
  });

  it('computes exponential backoff without jitter', () => {
    const first = computeBackoffMs(1, { baseMs: 1000, factor: 2, jitter: 0 });
    const second = computeBackoffMs(2, { baseMs: 1000, factor: 2, jitter: 0 });
    const third = computeBackoffMs(3, { baseMs: 1000, factor: 2, jitter: 0 });

    expect(first).toBe(1000);
    expect(second).toBe(2000);
    expect(third).toBe(4000);
  });
});

