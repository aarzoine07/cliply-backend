// C1: finish publish config API tests – do not redo existing behaviour, only fill gaps
import { beforeEach, describe, expect, it, vi } from 'vitest';

import accountsRoute from '../../apps/web/src/pages/api/accounts';
import publishConfigRoute from '../../apps/web/src/pages/api/accounts/publish';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof accountsRoute | typeof publishConfigRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe('GET /api/accounts/publish', () => {
  const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '123e4567-e89b-12d3-a456-426614174001';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get').get('/');
    expect(res.status).toBe(401);
  });

  it('returns connected accounts and publish config', async () => {
    // Create a YouTube account first
    const createRes = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
      });

    expect(createRes.status).toBe(200);

    // Get publish config
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('connectedAccounts');
    expect(res.body.data).toHaveProperty('publishConfig');
    expect(Array.isArray(res.body.data.connectedAccounts)).toBe(true);
    expect(res.body.data.publishConfig).toHaveProperty('platform', 'youtube');
    expect(res.body.data.publishConfig).toHaveProperty('enabled');
    expect(res.body.data.publishConfig).toHaveProperty('default_visibility');
  });

  it('returns default config when none exists', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body.data.publishConfig).toHaveProperty('enabled', true);
    expect(res.body.data.publishConfig).toHaveProperty('default_visibility', 'public');
    expect(res.body.data.publishConfig.default_connected_account_ids).toEqual([]);
  });
});

describe('PATCH /api/accounts/publish', () => {
  const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '123e4567-e89b-12d3-a456-426614174001';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('updates publish config', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: false,
        default_visibility: 'unlisted',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.data).toHaveProperty('enabled', false);
    expect(res.body.data).toHaveProperty('default_visibility', 'unlisted');
  });

  it('validates connected account IDs belong to workspace', async () => {
    // Create a YouTube account
    const createRes = await supertestHandler(toApiHandler(accountsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        platform: 'youtube',
        provider: 'google',
        external_id: `channel-${Date.now()}`,
        display_name: 'Test Channel',
      });

    expect(createRes.status).toBe(200);
    const accountId = createRes.body.data.id;

    // Update config with valid account ID
    const updateRes = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_connected_account_ids: [accountId],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.default_connected_account_ids).toContain(accountId);
  });

  it('rejects invalid connected account IDs', async () => {
    const fakeAccountId = '123e4567-e89b-12d3-a456-426614174999';

    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_connected_account_ids: [fakeAccountId],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it('rejects invalid visibility', async () => {
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        default_visibility: 'invalid',
      });

    expect(res.status).toBe(400);
  });

  it('handles partial updates', async () => {
    // First set some values
    await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: false,
        default_visibility: 'private',
      });

    // Then update only enabled
    const res = await supertestHandler(toApiHandler(publishConfigRoute), 'patch')
      .patch('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        enabled: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.default_visibility).toBe('private'); // Should remain unchanged
  });
});

