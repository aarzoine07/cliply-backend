import { beforeEach, describe, expect, it, vi } from 'vitest';

import productsRoute from '../../apps/web/src/pages/api/dropshipping/products';
import productByIdRoute from '../../apps/web/src/pages/api/dropshipping/products/[id]';
import { supertestHandler } from '../utils/supertest-next';

const toApiHandler = (handler: typeof productsRoute | typeof productByIdRoute) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/dropshipping/products', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(productsRoute), 'get').get('/');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('lists products for workspace', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(productsRoute), 'get')
      .get('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('products');
    expect(Array.isArray(res.body.products)).toBe(true);
  });
});

describe('POST /api/dropshipping/products', () => {
  it('returns 401 without session header', async () => {
    const res = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .send({
        name: 'Test Product',
        slug: 'test-product',
      });
    expect(res.status).toBe(401);
  });

  it('creates a new product', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
        description: 'A test product',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('slug');
    expect(res.body).toHaveProperty('workspace_id', workspaceId);
    expect(res.body).toHaveProperty('product_type', 'dropshipping');
    expect(res.body).toHaveProperty('status', 'active');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('updated_at');
  });

  it('returns 400 for invalid payload', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        name: '', // Invalid: empty name
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('normalizes slug correctly', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    const res = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        name: 'Test Product',
        slug: '  Test Product With Spaces  ',
      });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('test-product-with-spaces');
  });
});

describe('GET /api/dropshipping/products/:id', () => {
  it('returns 401 without session header', async () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    const mockReq = {
      method: 'GET',
      query: { id: productId },
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    try {
      await productByIdRoute(mockReq, mockRes);
    } catch (error: any) {
      expect(error.statusCode).toBe(401);
    }
  });

  it('returns 404 for non-existent product', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const productId = '123e4567-e89b-12d3-a456-426614174999';

    const mockReq = {
      method: 'GET',
      query: { id: productId },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('returns product when found', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // First create a product
    const createRes = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
      });

    expect(createRes.status).toBe(201);
    const productId = createRes.body.id;

    // Then get it
    const mockReq = {
      method: 'GET',
      query: { id: productId },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        id: productId,
      }),
    );
  });
});

describe('PATCH /api/dropshipping/products/:id', () => {
  it('returns 401 without session header', async () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    const mockReq = {
      method: 'PATCH',
      query: { id: productId },
      body: { name: 'Updated Name' },
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    try {
      await productByIdRoute(mockReq, mockRes);
    } catch (error: any) {
      expect(error.statusCode).toBe(401);
    }
  });

  it('updates product name and status', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // First create a product
    const createRes = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId)
      .send({
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
      });

    expect(createRes.status).toBe(201);
    const productId = createRes.body.id;

    // Then update it
    const mockReq = {
      method: 'PATCH',
      query: { id: productId },
      body: {
        name: 'Updated Product Name',
        status: 'paused',
      },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        id: productId,
        name: 'Updated Product Name',
        status: 'paused',
      }),
    );
  });

  it('returns 404 for non-existent product', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const productId = '123e4567-e89b-12d3-a456-426614174999';

    const mockReq = {
      method: 'PATCH',
      query: { id: productId },
      body: { name: 'Updated Name' },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 for invalid status', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const productId = '123e4567-e89b-12d3-a456-426614174000';

    const mockReq = {
      method: 'PATCH',
      query: { id: productId },
      body: { status: 'invalid' },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});

describe('Workspace isolation', () => {
  it('does not return products from different workspace', async () => {
    const workspaceId1 = '123e4567-e89b-12d3-a456-426614174000';
    const workspaceId2 = '223e4567-e89b-12d3-a456-426614174000';
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    // Create product in workspace 1
    const createRes = await supertestHandler(toApiHandler(productsRoute), 'post')
      .post('/')
      .set('x-debug-user', userId)
      .set('x-debug-workspace', workspaceId1)
      .send({
        name: `Workspace 1 Product ${Date.now()}`,
        slug: `ws1-product-${Date.now()}`,
      });

    expect(createRes.status).toBe(201);
    const productId = createRes.body.id;

    // Try to get it from workspace 2
    const mockReq = {
      method: 'GET',
      query: { id: productId },
      headers: {
        'x-debug-user': userId,
        'x-debug-workspace': workspaceId2,
      },
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    } as any;

    await productByIdRoute(mockReq, mockRes);

    // Should return 404 because product doesn't belong to workspace 2
    expect(mockRes.status).toHaveBeenCalledWith(404);
  });
});

