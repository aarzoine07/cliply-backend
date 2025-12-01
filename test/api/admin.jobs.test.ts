import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supertestHandler } from '../utils/supertest-next';
import * as supabase from '../../apps/web/src/lib/supabase';

// Mock Supabase client creation
const { mockSupabaseClientFactory } = vi.hoisted(() => ({
  mockSupabaseClientFactory: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseClientFactory,
}));

const SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const MOCK_JOB_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE_ID = '99999999-9999-9999-9999-999999999999';

// Set service role key for tests
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

function createAdminMock() {
  const adminMock = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'jobs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
          update: vi.fn().mockReturnThis(),
          single: vi.fn(),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
  };
  return adminMock;
}

function mockAdminClient(admin: ReturnType<typeof createAdminMock>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
  mockSupabaseClientFactory.mockReturnValue(admin);
}

// Import route handlers directly
import retryRoute from '../../apps/web/src/pages/api/admin/jobs/[id]/retry';
import cancelRoute from '../../apps/web/src/pages/api/admin/jobs/[id]/cancel';
import unlockRoute from '../../apps/web/src/pages/api/admin/jobs/[id]/unlock';

describe('Admin Job Management APIs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSupabaseClientFactory.mockClear();
  });

  describe('Authentication', () => {
    it('returns 403 when service role key is missing', async () => {
      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler).post('/').send({});
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('forbidden');
    });

    it('returns 403 when service role key is invalid', async () => {
      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', 'Bearer wrong-key')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });

    it('allows access with valid service role key', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      // Mock job fetch to return a job
      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'failed',
        state: 'error',
        worker_id: null,
        last_heartbeat: null,
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'queued', state: 'queued' },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /api/admin/jobs/[id]/retry', () => {
    it('retries a failed job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'failed',
        state: 'error',
        worker_id: 'worker-123',
        last_heartbeat: new Date().toISOString(),
      };

      let updateCalled = false;
      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockImplementation((values: any) => {
              updateCalled = true;
              expect(values.status).toBe('queued');
              expect(values.worker_id).toBeNull();
              expect(values.last_heartbeat).toBeNull();
              return chain;
            }),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'queued', state: 'queued', worker_id: null },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.status).toBe('queued');
      expect(updateCalled).toBe(true);
    });

    it('retries a queued job (stuck)', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'queued',
        state: 'queued',
        worker_id: null,
        last_heartbeat: null,
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, run_after: new Date().toISOString() },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when trying to retry a running job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'running',
        state: 'running',
        worker_id: 'worker-123',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('invalid_request');
      expect(res.body.message).toContain('running');
    });

    it('returns 404 when job not found', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('not_found');
    });
  });

  describe('POST /api/admin/jobs/[id]/cancel', () => {
    it('cancels a queued job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'queued',
        state: 'queued',
        worker_id: null,
      };

      let updateCalled = false;
      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockImplementation((values: any) => {
              updateCalled = true;
              expect(values.status).toBe('failed');
              expect(values.state).toBe('error');
              expect(values.worker_id).toBeNull();
              expect(values.error).toBeDefined();
              expect(values.error.message).toBe('Job canceled by admin');
              return chain;
            }),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'failed', state: 'error', error: { message: 'Job canceled by admin' } },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return cancelRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.job.status).toBe('failed');
      expect(updateCalled).toBe(true);
    });

    it('cancels a running job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'running',
        state: 'running',
        worker_id: 'worker-123',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'failed', state: 'error', worker_id: null },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return cancelRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.job.status).toBe('failed');
    });

    it('returns 400 when trying to cancel a succeeded job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'succeeded',
        state: 'done',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return cancelRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('invalid_request');
      expect(res.body.message).toContain('already succeeded');
    });

    it('returns 400 when trying to cancel a failed job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'failed',
        state: 'error',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return cancelRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('already failed');
    });
  });

  describe('POST /api/admin/jobs/[id]/unlock', () => {
    it('unlocks a running job with stale heartbeat', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const staleDate = new Date(Date.now() - 300 * 1000); // 5 minutes ago
      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'running',
        state: 'running',
        worker_id: 'worker-123',
        last_heartbeat: staleDate.toISOString(),
      };

      let updateCalled = false;
      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockImplementation((values: any) => {
              updateCalled = true;
              expect(values.status).toBe('queued');
              expect(values.state).toBe('queued');
              expect(values.worker_id).toBeNull();
              expect(values.last_heartbeat).toBeNull();
              return chain;
            }),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'queued', state: 'queued', worker_id: null },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return unlockRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.job.status).toBe('queued');
      expect(res.body.job.worker_id).toBeNull();
      expect(updateCalled).toBe(true);
    });

    it('unlocks a queued job (clears any stale locks)', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'queued',
        state: 'queued',
        worker_id: 'stale-worker',
        last_heartbeat: new Date(Date.now() - 1000).toISOString(),
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, worker_id: null, last_heartbeat: null },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return unlockRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when trying to unlock a succeeded job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'succeeded',
        state: 'done',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return unlockRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('invalid_request');
      expect(res.body.message).toContain('already succeeded');
    });

    it('returns 400 when trying to unlock a failed job', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: MOCK_WORKSPACE_ID,
        status: 'failed',
        state: 'error',
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return unlockRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('already failed');
    });
  });

  describe('Workspace Isolation', () => {
    it('can operate on jobs from any workspace (admin privilege)', async () => {
      const admin = createAdminMock();
      mockAdminClient(admin);

      // Job from different workspace
      const mockJob = {
        id: MOCK_JOB_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        status: 'failed',
        state: 'error',
        worker_id: null,
      };

      (admin.from as any).mockImplementation((table: string) => {
        if (table === 'jobs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            update: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { ...mockJob, status: 'queued', state: 'queued' },
              error: null,
            }),
          };
          chain.eq = vi.fn().mockReturnValue(chain);
          return chain;
        }
        return admin.from(table);
      });

      const handler = (req: any, res: any) => {
        Object.defineProperty(req, 'query', {
          value: { id: MOCK_JOB_ID },
          writable: true,
          configurable: true,
        });
        return retryRoute(req, res);
      };
      const res = await supertestHandler(handler)
        .post('/')
        .set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
        .send({});

      // Admin can operate on any job (no workspace restriction)
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});

