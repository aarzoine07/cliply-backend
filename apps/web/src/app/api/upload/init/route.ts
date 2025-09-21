import { randomUUID } from "node:crypto";

import type { UploadInitResponse } from "@cliply/shared/schemas/upload";
import { getExtension, UploadInitInputSchema } from "@cliply/shared/schemas/upload";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { HttpError, isHttpError } from "@/lib/errors";
import { getSignedUploadUrl } from "@/lib/storage";

const ROUTE_NAME = "/api/upload/init";
const SIGNED_URL_TTL_SECONDS = 600;
const STORAGE_BUCKET = "videos";

type ValidationErrorResponse = {
  error: string;
  issues?: unknown;
};

type ErrorResponse = {
  error: string;
};

export async function POST(req: Request) {
  let userId: string | undefined;
  let workspaceId: string | undefined;
  let projectId: string | undefined;

  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
    workspaceId = auth.workspaceId;

    const body = await parseJson(req);
    const validation = UploadInitInputSchema.safeParse(body);
    if (!validation.success) {
      const issues = validation.error.format();
      const hasSizeIssue = validation.error.issues.some((issue) => issue.message === "file too large");
      const status = hasSizeIssue ? 413 : 400;
      return NextResponse.json<ValidationErrorResponse>(
        {
          error: "invalid_request",
          issues,
        },
        { status },
      );
    }

    const payload = validation.data;
    const extension = getExtension(payload.filename);
    if (!extension) {
      throw new HttpError(400, "unsupported file extension");
    }

    projectId = randomUUID();
    const storageKey = buildStorageKey(workspaceId, projectId, extension);
    const storagePath = `${STORAGE_BUCKET}/${storageKey}`;
    const title = deriveTitle(payload.filename);

    const { error: insertError } = await auth.supabase
      .from("projects")
      .insert({
        id: projectId,
        workspace_id: workspaceId,
        title,
        source_type: "file",
        source_path: storagePath,
        status: "queued",
      });

    if (insertError) {
      throw new HttpError(500, "failed to create project", { cause: insertError, expose: false });
    }

    const uploadUrl = await getSignedUploadUrl(storageKey, SIGNED_URL_TTL_SECONDS, STORAGE_BUCKET);

    const response: UploadInitResponse = {
      uploadUrl,
      storagePath,
      projectId,
    };

    console.log(
      JSON.stringify({
        route: ROUTE_NAME,
        status: "success",
        userId,
        workspaceId,
        projectId,
      }),
    );

    return NextResponse.json(response);
  } catch (error) {
    const status = resolveStatus(error);
    const message = resolveMessage(error);

    console.error(
      JSON.stringify({
        route: ROUTE_NAME,
        status: "error",
        userId,
        workspaceId,
        projectId,
        message,
      }),
    );

    return NextResponse.json<ErrorResponse>({ error: message }, { status });
  }
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (error) {
    throw new HttpError(400, "invalid JSON body", { cause: error });
  }
}

function buildStorageKey(workspaceId: string, projectId: string, extension: string) {
  return `${workspaceId}/${projectId}/source${extension}`;
}

function deriveTitle(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return trimmed;
  return trimmed.slice(0, lastDot);
}

function resolveStatus(error: unknown): number {
  if (isHttpError(error)) return error.status;
  return 500;
}

function resolveMessage(error: unknown): string {
  if (isHttpError(error)) {
    return error.expose ? error.message : "internal_error";
  }
  if (error instanceof Error) {
    return "internal_error";
  }
  return "internal_error";
}
