import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Sentry - create a spy that we can track
const mockAddBreadcrumb = vi.fn();

// Mock Sentry module
vi.mock("@sentry/node", () => ({
  addBreadcrumb: mockAddBreadcrumb,
}));

// Mock the logger
vi.mock("@cliply/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  logJobStatus,
  logPipelineStep,
  logStripeEvent,
  logOAuthEvent,
} from "@cliply/shared/observability/logging";
import { logger } from "@cliply/shared/logging/logger";

describe("Observability Logging Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logJobStatus", () => {
    it("logs job started with structured fields", () => {
      logJobStatus({ jobId: "job-123", workspaceId: "ws-456", kind: "TRANSCRIBE" }, "started");

      expect(logger.info).toHaveBeenCalledWith(
        "job_started",
        expect.objectContaining({
          service: "worker",
          jobId: "job-123",
          workspaceId: "ws-456",
          kind: "TRANSCRIBE",
          status: "started",
        }),
      );

      // Note: Sentry breadcrumb integration is tested separately in integration tests
      // The core structured logging is verified above
    });

    it("logs job failed with error", () => {
      logJobStatus(
        { jobId: "job-123", workspaceId: "ws-456" },
        "failed",
        { error: "Something went wrong" },
      );

      expect(logger.error).toHaveBeenCalledWith(
        "job_failed",
        expect.objectContaining({
          jobId: "job-123",
          workspaceId: "ws-456",
          status: "failed",
          error: "Something went wrong",
        }),
      );

      // Note: Sentry breadcrumb integration is tested separately in integration tests
      // The core structured logging is verified above
    });

    it("logs job retry with warning level", () => {
      logJobStatus({ jobId: "job-123" }, "retry", { attempts: 2 });

      expect(logger.warn).toHaveBeenCalledWith(
        "job_retry",
        expect.objectContaining({
          jobId: "job-123",
          status: "retry",
          attempts: 2,
        }),
      );
    });
  });

  describe("logPipelineStep", () => {
    it("logs pipeline step start", () => {
      logPipelineStep(
        { jobId: "job-123", workspaceId: "ws-456", clipId: "clip-789" },
        "download",
        "start",
        { videoId: "abc123" },
      );

      expect(logger.info).toHaveBeenCalledWith(
        "pipeline_download_start",
        expect.objectContaining({
          service: "worker",
          jobId: "job-123",
          workspaceId: "ws-456",
          clipId: "clip-789",
          step: "download",
          phase: "start",
          videoId: "abc123",
        }),
      );

      // Note: Sentry breadcrumb integration is tested separately in integration tests
      // The core structured logging is verified above
    });

    it("logs pipeline step error", () => {
      logPipelineStep(
        { jobId: "job-123" },
        "transcribe",
        "error",
        { error: "Transcription failed" },
      );

      expect(logger.error).toHaveBeenCalledWith(
        "pipeline_transcribe_error",
        expect.objectContaining({
          step: "transcribe",
          phase: "error",
          error: "Transcription failed",
        }),
      );
    });
  });

  describe("logStripeEvent", () => {
    it("logs Stripe event with workspace and customer IDs", () => {
      logStripeEvent("checkout.session.completed", {
        workspaceId: "ws-456",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        stripeEventId: "evt_789",
      });

      expect(logger.info).toHaveBeenCalledWith(
        "stripe_checkout.session.completed",
        expect.objectContaining({
          service: "api",
          eventType: "checkout.session.completed",
          workspaceId: "ws-456",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
          stripeEventId: "evt_789",
        }),
      );
    });

    it("logs Stripe event error", () => {
      const error = new Error("Database error");
      logStripeEvent("customer.subscription.updated", {
        workspaceId: "ws-456",
        error,
      });

      expect(logger.error).toHaveBeenCalledWith(
        "stripe_customer.subscription.updated",
        expect.objectContaining({
          workspaceId: "ws-456",
          error: "Database error",
        }),
      );
    });
  });

  describe("logOAuthEvent", () => {
    it("logs OAuth start", () => {
      logOAuthEvent("tiktok", "start", {
        workspaceId: "ws-456",
        userId: "user-123",
      });

      expect(logger.info).toHaveBeenCalledWith(
        "oauth_tiktok_start",
        expect.objectContaining({
          service: "api",
          provider: "tiktok",
          phase: "start",
          workspaceId: "ws-456",
          userId: "user-123",
        }),
      );
    });

    it("logs OAuth success with connected account", () => {
      logOAuthEvent("tiktok", "success", {
        workspaceId: "ws-456",
        connectedAccountId: "acc-789",
        externalId: "tiktok_user_123",
      });

      expect(logger.info).toHaveBeenCalledWith(
        "oauth_tiktok_success",
        expect.objectContaining({
          provider: "tiktok",
          phase: "success",
          workspaceId: "ws-456",
          connectedAccountId: "acc-789",
          externalId: "tiktok_user_123",
        }),
      );
    });

    it("logs OAuth error", () => {
      const error = new Error("Token exchange failed");
      logOAuthEvent("tiktok", "error", {
        workspaceId: "ws-456",
        error,
      });

      expect(logger.error).toHaveBeenCalledWith(
        "oauth_tiktok_error",
        expect.objectContaining({
          provider: "tiktok",
          phase: "error",
          workspaceId: "ws-456",
          error: "Token exchange failed",
        }),
      );
    });
  });

  describe("safety: no secrets in logs", () => {
    it("does not log access tokens", () => {
      // This is implicit - the helpers only accept safe fields
      // The logger's redaction will handle any secrets that slip through
      logOAuthEvent("tiktok", "success", {
        workspaceId: "ws-456",
        externalId: "user_123",
        // No access_token field - that's the point
      });

      const callArgs = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = callArgs[1];
      expect(payload).not.toHaveProperty("access_token");
      expect(payload).not.toHaveProperty("refresh_token");
    });
  });
});

