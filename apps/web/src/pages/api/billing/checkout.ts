import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { z } from 'zod';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { STRIPE_PLAN_MAP } from '@cliply/shared/billing/stripePlanMap';
import type { PlanName } from '@cliply/shared/types/auth';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not configured');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

const CheckoutRequestSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('billing_checkout_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId } = auth;

  const rate = await checkRateLimit(userId, 'billing:checkout');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  // Validate request body
  const validation = CheckoutRequestSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json(err('invalid_request', validation.error.message));
    return;
  }

  const { priceId, successUrl, cancelUrl } = validation.data;

  // Verify priceId is valid
  if (!STRIPE_PLAN_MAP[priceId]) {
    res.status(400).json(err('invalid_price', 'Invalid price ID'));
    return;
  }

  try {
    
    // Create Stripe checkout session
    // ✅ explicitly type the call against Stripe.Checkout.SessionCreateParams
const params: Stripe.Checkout.SessionCreateParams = {
  mode: "subscription",
  payment_method_types: ["card"],
  line_items: [
    {
      price: priceId,
      quantity: 1,
    },
  ],
  success_url: successUrl,
  cancel_url: cancelUrl,
  metadata: {
    workspace_id: workspaceId,
  },
};

const session = await stripe.checkout.sessions.create(params);

    logger.info('billing_checkout_success', {
      userId,
      workspaceId,
      priceId,
      sessionId: session.id,
      durationMs: Date.now() - started,
      remainingTokens: rate.remaining,
    });

    res.status(200).json(ok({ checkoutUrl: session.url, sessionId: session.id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    logger.error('billing_checkout_error', { userId, workspaceId, priceId, error: message });
    res.status(500).json(err('checkout_error', message));
  }
});