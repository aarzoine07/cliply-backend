import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { handler, ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { STRIPE_PLAN_MAP } from "@cliply/shared/billing/stripePlanMap";
import type { PlanName } from "@cliply/shared/types/auth";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

const CheckoutRequestSchema = z
  .object({
    priceId: z.string().min(1).max(255), // Stripe price IDs are typically short
    successUrl: z.string().url().max(2048).optional(), // Reasonable URL length limit
    cancelUrl: z.string().url().max(2048).optional(), // Reasonable URL length limit
  })
  .strict(); // Reject unknown fields

// Configure body size limit for this endpoint (1MB for JSON)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info("billing_checkout_start", { method: req.method ?? "GET" });

  // ---- Security headers + CORS (inlined, replaces applySecurityAndCors) ----
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Idempotency-Key",
  );

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  // -------------------------------------------------------------------------  

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId } = auth;

  const rate = await checkRateLimit(userId, "billing:checkout");
  if (!rate.allowed) {
    res.status(429).json(err("too_many_requests", "Rate limited"));
    return;
  }

  // Validate request body
  const validation = CheckoutRequestSchema.safeParse(req.body);
  if (!validation.success) {
    res
      .status(400)
      .json(err("invalid_request", "Invalid payload", validation.error.flatten()));
    return;
  }

  const { priceId, successUrl, cancelUrl } = validation.data;

  // Verify priceId is valid
  if (!STRIPE_PLAN_MAP[priceId]) {
    res.status(400).json(err("invalid_price", "Invalid price ID"));
    return;
  }

  // If client sends Idempotency-Key, forward it to Stripe so duplicates
  // don't create multiple checkout sessions.
  const idempotencyKeyHeader =
    (req.headers["idempotency-key"] as string | undefined) ??
    (req.headers["Idempotency-Key"] as string | undefined);

  const createCheckoutSession = async (): Promise<{
    checkoutUrl: string | null;
    sessionId: string;
  }> => {
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
        // Ensure we never pass `undefined` into Stripe metadata
        workspace_id: workspaceId ?? null,
      },
    };

    const requestOptions: Stripe.RequestOptions = {};
    if (idempotencyKeyHeader) {
      requestOptions.idempotencyKey = idempotencyKeyHeader;
    }

    const session = await stripe.checkout.sessions.create(params, requestOptions);
    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  };

  /**
   * Determine if a Stripe error should be retried
   * Only retry on network errors and clearly transient Stripe errors (5xx)
   * Do NOT retry on card declines, validation errors, or auth errors
   */
  function shouldRetryForStripe(error: unknown): boolean {
    // Network errors and timeouts
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        return true;
      }
      if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
        return true;
      }
    }

    // Stripe errors
    if (error && typeof error === "object" && "type" in error) {
      const stripeError = error as { type?: string; statusCode?: number };

      // Retry on 5xx server errors
      if (stripeError.statusCode && stripeError.statusCode >= 500) {
        return true;
      }

      // Do NOT retry on:
      // - card_declined
      // - invalid_request_error
      // - authentication_error
      if (stripeError.type) {
        const nonRetryableTypes = [
          "card_error",
          "invalid_request_error",
          "authentication_error",
        ];
        if (nonRetryableTypes.includes(stripeError.type)) {
          return false;
        }
      }
    }

    // Default: don't retry unknown errors
    return false;
  }

  try {
    const result = await createCheckoutSession();

    logger.info("billing_checkout_success", {
      userId,
      workspaceId,
      priceId,
      sessionId: result.sessionId,
      idempotent: Boolean(idempotencyKeyHeader),
      durationMs: Date.now() - started,
      remainingTokens: rate.remaining,
    });

    res.status(200).json(
      ok({
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
        idempotent: Boolean(idempotencyKeyHeader),
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create checkout session";
    logger.error("billing_checkout_error", { userId, workspaceId, priceId, error: message });
    res.status(500).json(err("checkout_error", message));
  }
});
