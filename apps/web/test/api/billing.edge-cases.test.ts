// @ts-nocheck
/**
 * Billing Edge Cases Tests
 *
 * These tests verify billing API error handling and success responses:
 * - Missing workspace context (400)
 * - Workspace not found in database (404)
 * - Successful billing status retrieval (200)
 *
 * NOTE: workspace_not_configured guard (for missing stripe_customer_id)
 * is a future enhancement - see commented tests at bottom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import billingStatusRoute from '../../src/pages/api/billing/status';
import { supertestHandler } from '../../../../test/utils/supertest-next';
import * as supabase from '../../src/lib/supabase';
import * as usageService from '../../src/lib/billing/usageService';
import { ERROR_CODES } from '@cliply/shared/errorCodes';

const toApiHandler = (handler: any) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';

describe('🧩 Billing Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/billing/status', () => {
    it('returns 404 when workspace not found', async () => {
      vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockRejectedValue(
        new Error('Workspace not found')
      );

      const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
        .get('/')
        .set(commonHeaders);

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('workspace_not_found');
    });

    it('returns 400 when workspace context is missing', async () => {
      const headersWithoutWorkspace = {
        'x-debug-user': '00000000-0000-0000-0000-000000000001',
        // No workspace header
      };

      const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
        .get('/')
        .set(headersWithoutWorkspace);

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns billing status successfully when workspace exists', async () => {
      vi.spyOn(usageService, 'getWorkspaceUsageSummary').mockResolvedValue({
        plan: {
          tier: 'free',
          billingStatus: 'active',
          trial: { active: false, endsAt: null },
        },
        usage: {
          minutes: { used: 10, limit: 100, remaining: 90, softLimit: false, hardLimit: false },
          clips: { used: 5, limit: 50, remaining: 45, softLimit: false, hardLimit: false },
          projects: { used: 2, limit: 10, remaining: 8, softLimit: false, hardLimit: false },
          posts: { used: 1, limit: 20, remaining: 19, softLimit: false, hardLimit: false },
        },
      });

      const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
        .get('/')
        .set(commonHeaders);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.plan.tier).toBe('free');
    });
  });

  /**
   * NOTE: workspace_not_configured tests
   *
   * Per Task 7B, billing endpoints should return workspace_not_configured
   * when stripe_customer_id or plan is missing. If not yet implemented,
   * uncomment and adjust these tests once the guard is added.
   */
  // describe('workspace_not_configured scenarios', () => {
  //   it('returns workspace_not_configured when stripe_customer_id is missing', async () => {
  //     // Mock workspace with missing stripe_customer_id
  //     const res = await supertestHandler(toApiHandler(billingStatusRoute), 'get')
  //       .get('/')
  //       .set(commonHeaders);
  //
  //     expect(res.status).toBe(400);
  //     expect(res.body.ok).toBe(false);
  //     expect(res.body.error.code).toBe(ERROR_CODES.workspace_not_configured);
  //   });
  // });
});
