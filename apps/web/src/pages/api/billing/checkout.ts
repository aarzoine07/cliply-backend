import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { handler, ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { STRIPE_PLAN_MAP } from "@cliply/shared/billing/stripePlanMap";
import type { PlanName } from "@cliply/shared/types/auth";
import { runIdempotent, extractIdempotencyKey } from "@cliply/shared/idempotency/idempotencyHelper";
import { getAdminClient } from "@/lib/supabase";

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

  // ---- Security headers + CORS ----
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

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId } = auth;
  const workspaceIdStr = workspaceId ?? "";

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

  const admin = getAdminClient();
  const requestBody = { priceId, successUrl, cancelUrl, workspaceId: workspaceIdStr };

  // Extract idempotency key from header
  const idempotencyKey = extractIdempotencyKey(req);

  let result: { checkoutUrl: string | null; sessionId: string };
  let isIdempotent = false;

  // Create checkout session
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
        // Force a string for Stripe metadata; fall back to empty string
        workspace_id: workspaceIdStr,
      },
    };

    const session = await stripe.checkout.sessions.create(params);
    return { checkoutUrl: session.url, sessionId: session.id };
  };

  /**
   * Determine if a Stripe error should be retried
   * (Kept for future use if we reintroduce withRetry here.)
   *
   * Only retry on network errors and clearly transient Stripe errors (5xx)
   * Do NOT retry on card declines, validation errors, or auth errors
   */
  function shouldRetryForStripe(error: unknown): boolean {
    // Network errors and timeouts
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        return true;
      }
      if (
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ENOTFOUND")
      ) {
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
    if (idempotencyKey) {
      // Use idempotency when header is present
      try {
        const idempotencyResult = await runIdempotent(
          {
            supabaseAdminClient: admin,
            workspaceId: workspaceIdStr,
            userId,
            key: idempotencyKey,
            endpoint: "billing/checkout",
          },
          requestBody,
          createCheckoutSession,
          { storeResponseJson: true }, // Store response JSON for replay
        );

        if (idempotencyResult.reused) {
          // Retrieve stored response (stored as JSON in response_hash)
          if (
            idempotencyResult.storedResponse &&
            typeof idempotencyResult.storedResponse === "object"
          ) {
            const stored = idempotencyResult.storedResponse as {
              checkoutUrl?: string | null;
              sessionId?: string;
            };
            if (stored.sessionId) {
              result = {
                checkoutUrl: stored.checkoutUrl ?? null,
                sessionId: stored.sessionId,
              };
              isIdempotent = true;
            } else {
              // Invalid stored data
              logger.warn("billing_checkout_idempotent_reuse_invalid_data", {
                workspaceId: workspaceIdStr,
                priceId,
                idempotencyKey,
              });
              res
                .status(500)
                .json(err("internal_error", "Failed to retrieve stored checkout session"));
              return;
            }
          } else {
            // No stored response
            logger.warn("billing_checkout_idempotent_reuse_no_stored_data", {
              workspaceId: workspaceIdStr,
              priceId,
              idempotencyKey,
            });
            res
              .status(500)
              .json(err("internal_error", "Failed to retrieve stored checkout session"));
            return;
          }
        } else {
          // `response` is typed as unknown in the shared helper; assert the concrete shape here.
          result = idempotencyResult.response as {
            checkoutUrl: string | null;
            sessionId: string;
          };
          isIdempotent = false;
        }
      } catch (error) {
        const errorMessage = (error as Error)?.message ?? "Unknown error";
        if (errorMessage.includes("conflict")) {
          res.status(400).json(err("idempotency_conflict", errorMessage));
          return;
        } else if (errorMessage.includes("still processing")) {
          res.status(409).json(err("request_pending", errorMessage));
          return;
        }
        // For other errors, log and continue without idempotency
        logger.warn("billing_checkout_idempotency_error", {
          workspaceId: workspaceIdStr,
          error: errorMessage,
        });
        // Fall through to execute without idempotency
        result = await createCheckoutSession();
        isIdempotent = false;
      }
    } else {
      // No idempotency header - execute normally (backwards compatible)
      result = await createCheckoutSession();
      isIdempotent = false;
    }

    logger.info("billing_checkout_success", {
      userId,
      workspaceId: workspaceIdStr,
      priceId,
      sessionId: result.sessionId,
      idempotent: isIdempotent,
      durationMs: Date.now() - started,
      remainingTokens: rate.remaining,
    });

    res.status(200).json(
      ok({
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
        idempotent: isIdempotent,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create checkout session";
    logger.error("billing_checkout_error", {
      userId,
      workspaceId: workspaceIdStr,
      priceId,
      error: message,
    });
    res.status(500).json(err("checkout_error", message));
  }
});
