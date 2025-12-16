import { beforeEach, describe, expect, it, vi } from 'vitest';

import accountsRoute from '../../apps/web/src/pages/api/accounts';
import accountByIdRoute from '../../apps/web/src/pages/api/accounts/[id]';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (
  handler: typeof accountsRoute | typeof accountByIdRoute,
) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

// Seeded debug identities used across the API test suite
const TEST_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/accounts', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('lists connected accounts for workspace', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID);

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('accounts');
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  it('filters by platform when provided', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/?platform=youtube')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID);

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('accounts');
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  it('returns 400 for invalid platform', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'get')
      .get('/?platform=invalid')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/accounts', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: 'channel-123',
      });

    expect(res.status).toBe(401);
  });

  it('creates a new connected account', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
        handle: '@testchannel',
      });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 400 for invalid payload', async () => {
    const res = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({
        platform: 'invalid',
      });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/accounts/:id', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(accountByIdRoute), 'patch')
      .patch('/?id=123e4567-e89b-12d3-a456-426614174000')
      .send({ status: 'revoked' });

    expect(res.status).toBe(401);
  });

  it('updates account status', async () => {
    // create an account first
    const createRes = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
      });

    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.body).toHaveProperty('ok', true);

    const id =
      createRes.body?.data?.id ??
      createRes.body?.data?.account?.id ??
      createRes.body?.data?.connectedAccount?.id;

    expect(typeof id).toBe('string');

    const res = await supertestHandler(toApiHandler(accountByIdRoute), 'patch')
      .patch(`/?id=${id}`)
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({ status: 'revoked' });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('returns 404 for non-existent account', async () => {
    const res = await supertestHandler(toApiHandler(accountByIdRoute), 'patch')
      .patch('/?id=123e4567-e89b-12d3-a456-426614174999')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({ status: 'revoked' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await supertestHandler(toApiHandler(accountByIdRoute), 'patch')
      .patch('/?id=123e4567-e89b-12d3-a456-426614174000')
      .set('x-debug-user', TEST_USER_ID)
      .set('x-debug-workspace', TEST_WORKSPACE_ID)
      .send({ status: 'invalid' });

    expect(res.status).toBe(400);
  });
});