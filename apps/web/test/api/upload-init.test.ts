// @ts-nocheck
import { MAX_UPLOAD_SIZE_BYTES } from "@cliply/shared/schemas/upload";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  getSignedUploadUrl: vi.fn(),
}));

import { POST } from "@/app/api/upload/init/route";
import type { AuthContext } from "@/lib/auth";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { getSignedUploadUrl } from "@/lib/storage";

const requireAuthMock = vi.mocked(requireAuth);
const getSignedUploadUrlMock = vi.mocked(getSignedUploadUrl);

const validPayload = {
  source: "file" as const,
  filename: "demo.mp4",
  size: 1024,
  mime: "video/mp4" as const,
};

describe("POST /api/upload/init", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when session is missing", async () => {
    requireAuthMock.mockRejectedValue(new HttpError(401, "missing session"));

    const response = await POST(createRequest(validPayload));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: "missing session" });
  });

  it("returns 400 for invalid payload", async () => {
    const { authContext, fromSpy } = createAuthContext();
    requireAuthMock.mockResolvedValue(authContext);

    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("invalid_request");
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns 413 when file exceeds size limit", async () => {
    const { authContext } = createAuthContext();
    requireAuthMock.mockResolvedValue(authContext);

    const response = await POST(
      createRequest({
        ...validPayload,
        size: MAX_UPLOAD_SIZE_BYTES + 1,
      }),
    );

    expect(response.status).toBe(413);
    const json = await response.json();
    expect(json.error).toBe("invalid_request");
  });

  it("returns 400 when mime does not match extension", async () => {
    const { authContext } = createAuthContext();
    requireAuthMock.mockResolvedValue(authContext);

    const response = await POST(
      createRequest({
        ...validPayload,
        filename: "demo.mov",
        mime: "video/mp4",
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("invalid_request");
  });

  it("returns signed upload details on success", async () => {
    const { authContext, insertSpy } = createAuthContext();
    requireAuthMock.mockResolvedValue(authContext);
    getSignedUploadUrlMock.mockResolvedValue("https://signed.example/upload");

    const response = await POST(createRequest(validPayload));

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      uploadUrl: string;
      storagePath: string;
      projectId: string;
    };

    expect(json.uploadUrl).toBe("https://signed.example/upload");
    expect(json.storagePath).toMatch(/^videos\/workspace-123\/[0-9a-f\-]{36}\/source\.mp4$/);
    expect(validateUuid(json.projectId)).toBe(true);

    const storageKey = `workspace-123/${json.projectId}/source.mp4`;
    expect(getSignedUploadUrlMock).toHaveBeenCalledWith(storageKey, 600, "videos");
    expect(insertSpy).toHaveBeenCalledWith({
      id: json.projectId,
      workspace_id: "workspace-123",
      title: "demo",
      source_type: "file",
      source_path: `videos/${storageKey}`,
      status: "queued",
    });
  });
});

function createRequest(body: unknown) {
  return new Request("http://localhost/api/upload/init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createAuthContext() {
  const insertSpy = vi.fn().mockResolvedValue({ error: null });
  const fromSpy = vi.fn().mockReturnValue({ insert: insertSpy });

  const authContext: AuthContext = {
    supabase: { from: fromSpy } as unknown as AuthContext["supabase"],
    userId: "user-456",
    workspaceId: "workspace-123",
    accessToken: "token",
  };

  return { authContext, insertSpy, fromSpy };
}

function validateUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
