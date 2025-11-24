import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUCKET_VIDEOS } from "@cliply/shared/constants";
import type { Job, WorkerContext } from "../src/pipelines/types";
import { run as runYouTubeDownload } from "../src/pipelines/youtube-download";
import * as youtubeDownloadService from "../src/services/youtube/download";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("youtube-download pipeline", () => {
  let storage: ReturnType<typeof createStorageMock>;
  let supabase: ReturnType<typeof createSupabaseMock>;
  let logger: ReturnType<typeof createLoggerMock>;
  let queue: ReturnType<typeof createQueueMock>;
  let sentry: ReturnType<typeof createSentryMock>;
  let ctx: WorkerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createStorageMock({});
    supabase = createSupabaseMock({
      projects: [
        {
          id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          source_path: YOUTUBE_URL,
          status: "queued",
        },
      ],
    });
    logger = createLoggerMock();
    queue = createQueueMock();
    sentry = createSentryMock();
    ctx = {
      storage,
      supabase,
      logger,
      queue,
      sentry,
    };
  });

  it("downloads YouTube video and uploads to storage", async () => {
    const job: Job<{ projectId: string; youtubeUrl: string }> = {
      id: "youtube-download-job",
      type: "YOUTUBE_DOWNLOAD",
      workspaceId: WORKSPACE_ID,
      payload: {
        projectId: PROJECT_ID,
        youtubeUrl: YOUTUBE_URL,
      },
    };

    // Mock YouTube download service
    const tempPath = "/tmp/test-video.mp4";
    const downloadSpy = vi.spyOn(youtubeDownloadService, "downloadYouTubeVideo").mockResolvedValue({
      sizeBytes: 1024,
      localPath: tempPath,
    });

    // Create temp file for mock
    await fs.mkdir(dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, Buffer.from("test video content"));

    await runYouTubeDownload(job, ctx);

    // Verify download service was called with correct parameters
    expect(downloadSpy).toHaveBeenCalledWith({
      youtubeUrl: YOUTUBE_URL,
      targetBucket: BUCKET_VIDEOS,
      targetPath: `${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`,
    });

    // Verify storage.upload was called with correct parameters
    expect(storage.upload).toHaveBeenCalledWith(
      BUCKET_VIDEOS,
      `${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`,
      tempPath,
      "video/mp4",
    );

    // Verify project status was updated
    expect(supabase.state.projects[0].status).toBe("processing");
    expect(supabase.state.projects[0].source_path).toBe(
      `${BUCKET_VIDEOS}/${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`,
    );

    // Verify transcribe job was enqueued
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: "TRANSCRIBE",
      workspaceId: WORKSPACE_ID,
      payload: { projectId: PROJECT_ID, sourceExt: "mp4" },
    });

    // Cleanup
    await fs.unlink(tempPath).catch(() => {});
  });

  it("skips download if video already exists (idempotent)", async () => {
    const storageKey = `${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`;
    storage.files.set(`${BUCKET_VIDEOS}/${storageKey}`, "existing video");

    const job: Job<{ projectId: string; youtubeUrl: string }> = {
      id: "youtube-download-job",
      type: "YOUTUBE_DOWNLOAD",
      workspaceId: WORKSPACE_ID,
      payload: {
        projectId: PROJECT_ID,
        youtubeUrl: YOUTUBE_URL,
      },
    };

    await runYouTubeDownload(job, ctx);

    // Verify download service was NOT called
    expect(youtubeDownloadService.downloadYouTubeVideo).not.toHaveBeenCalled();

    // Verify storage.upload was NOT called
    expect(storage.upload).not.toHaveBeenCalled();

    // Verify transcribe job was still enqueued
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: "TRANSCRIBE",
      workspaceId: WORKSPACE_ID,
      payload: { projectId: PROJECT_ID, sourceExt: "mp4" },
    });
  });

  it("throws error for invalid YouTube URL", async () => {
    const job: Job<{ projectId: string; youtubeUrl: string }> = {
      id: "youtube-download-job",
      type: "YOUTUBE_DOWNLOAD",
      workspaceId: WORKSPACE_ID,
      payload: {
        projectId: PROJECT_ID,
        youtubeUrl: "https://invalid-url.com",
      },
    };

    await expect(runYouTubeDownload(job, ctx)).rejects.toThrow("Invalid YouTube URL");
  });

  it("throws error if project not found", async () => {
    supabase = createSupabaseMock({ projects: [] });
    ctx = { ...ctx, supabase };

    const job: Job<{ projectId: string; youtubeUrl: string }> = {
      id: "youtube-download-job",
      type: "YOUTUBE_DOWNLOAD",
      workspaceId: WORKSPACE_ID,
      payload: {
        projectId: PROJECT_ID,
        youtubeUrl: YOUTUBE_URL,
      },
    };

    await expect(runYouTubeDownload(job, ctx)).rejects.toThrow("Project not found");
  });
});

function createStorageMock(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));

  return {
    files,
    exists: vi.fn(async (bucket: string, path: string) => files.has(`${bucket}/${path}`)),
    list: vi.fn(async (bucket: string, prefix: string) =>
      Array.from(files.keys())
        .filter((key) => key.startsWith(`${bucket}/`))
        .map((key) => key.slice(`${bucket}/`.length))
        .filter((key) => key.startsWith(prefix)),
    ),
    download: vi.fn(async (bucket: string, path: string, destination: string) => {
      const key = `${bucket}/${path}`;
      const data = files.get(key);
      if (data === undefined) {
        throw new Error(`missing file: ${key}`);
      }
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.writeFile(destination, data, "utf8");
      return destination;
    }),
    upload: vi.fn(async (bucket: string, path: string, localFile: string) => {
      const data = await fs.readFile(localFile);
      files.set(`${bucket}/${path}`, data.toString("utf8"));
    }),
  };
}

type ProjectRow = {
  id: string;
  workspace_id: string;
  source_path?: string | null;
  status?: string;
};

function createSupabaseMock(initial: { projects: ProjectRow[] }) {
  const state = {
    projects: [...initial.projects],
  };

  return {
    state,
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string, value: unknown) => {
              if (column === "id") {
                const project = state.projects.find((p) => p.id === value);
                return {
                  data: project ? [project] : null,
                  error: null,
                };
              }
              return { data: null, error: null };
            }),
          })),
          update: vi.fn((updates: Record<string, unknown>) => ({
            eq: vi.fn((column: string, value: unknown) => {
              if (column === "id") {
                const project = state.projects.find((p) => p.id === value);
                if (project) {
                  Object.assign(project, updates);
                }
              }
              return { data: null, error: null };
            }),
          })),
        };
      }
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ data: null, error: null })) })),
        update: vi.fn(() => ({ eq: vi.fn(() => ({ data: null, error: null })) })),
      };
    }),
  };
}

function createLoggerMock() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createQueueMock() {
  return {
    enqueue: vi.fn(async () => {}),
  };
}

function createSentryMock() {
  return {
    captureException: vi.fn(),
  };
}

