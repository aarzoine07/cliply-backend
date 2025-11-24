import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as experimentService from '../../apps/web/src/lib/viral/experimentService';
import experimentsRoute from '../../apps/web/src/pages/api/viral/experiments';
import { supertestHandler } from '../utils/supertest-next';

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const toApiHandler = (handler: typeof experimentsRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/viral/experiments', () => {
  it('returns 401 when session header is missing', async () => {
    const res = await supertestHandler(toApiHandler(experimentsRoute), 'get').get('/');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns experiments list for workspace', async () => {
    vi.spyOn(experimentService, 'listExperiments').mockResolvedValue([
      {
        id: 'exp-1',
        workspace_id: '11111111-1111-1111-1111-111111111111',
        project_id: 'proj-1',
        name: 'Caption Test',
        status: 'running',
        goal_metric: 'views',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        variants: [
          {
            id: 'var-1',
            experiment_id: 'exp-1',
            label: 'A',
            config: { caption: 'Test A', hashtags: ['#test'] },
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);

    const res = await supertestHandler(toApiHandler(experimentsRoute), 'get')
      .get('/')
      .set(commonHeaders);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.experiments).toHaveLength(1);
    expect(res.body.experiments[0].name).toBe('Caption Test');
    expect(res.body.experiments[0].variants).toHaveLength(1);
  });
});

describe('POST /api/viral/experiments', () => {
  it('creates experiment with variants', async () => {
    const mockExperiment = {
      id: 'exp-new',
      workspace_id: '11111111-1111-1111-1111-111111111111',
      project_id: null,
      name: 'New Experiment',
      status: 'draft' as const,
      goal_metric: 'views' as const,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
      variants: [
        {
          id: 'var-new-1',
          experiment_id: 'exp-new',
          label: 'A',
          config: { caption: 'Caption A', hashtags: ['#test'] },
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'var-new-2',
          experiment_id: 'exp-new',
          label: 'B',
          config: { caption: 'Caption B', hashtags: ['#test2'] },
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    };

    vi.spyOn(experimentService, 'createExperimentWithVariants').mockResolvedValue(mockExperiment);

    const res = await supertestHandler(toApiHandler(experimentsRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        name: 'New Experiment',
        goal_metric: 'views',
        variants: [
          { label: 'A', config: { caption: 'Caption A', hashtags: ['#test'] } },
          { label: 'B', config: { caption: 'Caption B', hashtags: ['#test2'] } },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('New Experiment');
    expect(res.body.variants).toHaveLength(2);
    expect(res.body.variants[0].label).toBe('A');
    expect(res.body.variants[1].label).toBe('B');
  });

  it('returns 400 for invalid payload', async () => {
    const res = await supertestHandler(toApiHandler(experimentsRoute), 'post')
      .post('/')
      .set(commonHeaders)
      .send({
        name: '', // Invalid: empty name
        variants: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

