import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

import adminReadyzHandler from "../../apps/web/src/pages/api/admin/readyz";
import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

// Mock the readiness report builder
vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

describe("GET /api/admin/readyz", () => {
  let mockReq: Partial<NextApiRequest>;
  let mockRes: Partial<NextApiResponse>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStatus = vi.fn().mockReturnThis();
    mockJson = vi.fn().mockReturnThis();

    mockReq = {
      method: "GET",
    };

    mockRes = {
      status: mockStatus,
      json: mockJson,
      setHeader: vi.fn(),
    };
  });

  it("returns 200 when all checks pass", async () => {
    (buildBackendReadinessReport as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      db: { ok: true, tablesChecked: ["workspaces", "jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    await adminReadyzHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
      }),
    );
  });

  it("returns 503 when checks fail", async () => {
    (buildBackendReadinessReport as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      env: { ok: false, missing: ["SUPABASE_URL"], optionalMissing: [] },
      db: { ok: false, error: "Connection failed", tablesChecked: [], missingTables: [] },
      stripe: { ok: false, missingEnv: ["STRIPE_SECRET_KEY"], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    await adminReadyzHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    expect(mockStatus).toHaveBeenCalledWith(503);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  it("returns 405 for non-GET methods", async () => {
    mockReq.method = "POST";

    await adminReadyzHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    expect(mockStatus).toHaveBeenCalledWith(405);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: { message: "method_not_allowed" },
      }),
    );
  });

  it("returns 500 on fatal error", async () => {
    (buildBackendReadinessReport as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Fatal error"),
    );

    await adminReadyzHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: { message: "internal_error" },
      }),
    );
  });
});


