import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_RENDERS, BUCKET_THUMBS, BUCKET_TRANSCRIPTS, BUCKET_VIDEOS } from "@cliply/shared/constants";
import type { Job, WorkerContext } from "../src/pipelines/types.js";
import { run as runRender } from "../src/pipelines/clip-render.js";
import { run as runThumbnail } from "../src/pipelines/thumbnail.js";
import { run as runPublish } from "../src/pipelines/publish-youtube.js";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CLIP_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("../src/services/ffmpeg/run.js", () => {
  return {
    runFFmpeg: vi.fn(async (args: string[]) => {
      const outputs = args.filter((_, index) => {
        const prev = args[index - 1];
        return prev !== "-map" && prev !== "-frames:v";
      }).slice(-2);

      for (const output of outputs) {
        await fs.mkdir(dirname(output), { recursive: true });
        await fs.writeFile(output, "placeholder", "utf8");
      }
    }),
  };
});

vi.mock("../src/services/youtube/client.js", () => {
  return {
    YouTubeClient: class {
      constructor(private readonly config: { accessToken: string }) {
        if (!this.config.accessToken) {
          throw new Error("no token");
        }
      }

      async uploadShort() {
        return { videoId: `dryrun_${randomUUID()}` };
      }
    },
  };
});

describe("render + thumbnail + publish pipelines", () => {
  let storage: ReturnType<typeof createStorageMock>;
  let supabase: ReturnType<typeof createSupabaseMock>;
  let logger: ReturnType<typeof createLoggerMock>;
  let queue: ReturnType<typeof createQueueMock>;
  let sentry: ReturnType<typeof createSentryMock>;
  let ctx: WorkerContext;

  beforeEach(() => {
    storage = createStorageMock({
      [`${BUCKET_VIDEOS}/${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`]: "video-source",
      [`${BUCKET_TRANSCRIPTS}/${WORKSPACE_ID}/${PROJECT_ID}/transcript.srt`]: "1\n00:00:00,000 --> 00:00:05,000\ntext\n",
    });
    supabase = createSupabaseMock();
    logger = createLoggerMock();
    queue = createQueueMock();
    sentry = createSentryMock();
    ctx = {
      storage,
      supabase: supabase as unknown as SupabaseClient,
      logger,
      queue,
      sentry,
    };
  });

  it("renders clip, generates thumbnail, publishes youtube idempotently", async () => {
    const renderJob: Job<{ clipId: string }> = {
      id: "render-job",
      type: "CLIP_RENDER",
      workspaceId: WORKSPACE_ID,
      payload: { clipId: CLIP_ID },
    };

    const thumbJob: Job<{ clipId: string; atSec?: number }> = {
      id: "thumb-job",
      type: "THUMBNAIL_GEN",
      workspaceId: WORKSPACE_ID,
      payload: { clipId: CLIP_ID, atSec: 3 },
    };

    const publishJob: Job<{ clipId: string }> = {
      id: "publish-job",
      type: "PUBLISH_YOUTUBE",
      workspaceId: WORKSPACE_ID,
      payload: { clipId: CLIP_ID },
    };

    await runRender(renderJob, ctx);

    expect(storage.upload).toHaveBeenCalledWith(
      BUCKET_RENDERS,
      `${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
      expect.any(String),
      "video/mp4",
    );
    expect(storage.upload).toHaveBeenCalledWith(
      BUCKET_THUMBS,
      `${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.jpg`,
      expect.any(String),
      "image/jpeg",
    );
    expect(supabase.state.clips[0].status).toBe("ready");

    const uploadsAfterRender = storage.upload.mock.calls.length;
    await runRender(renderJob, ctx);
    expect(storage.upload.mock.calls.length).toBe(uploadsAfterRender);

    await runThumbnail(thumbJob, ctx);
    await runThumbnail(thumbJob, ctx);
    expect(storage.upload.mock.calls.length).toBe(uploadsAfterRender + 1);
    expect(supabase.state.clips[0].thumb_path).toBe(`${BUCKET_THUMBS}/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.jpg`);

    await runPublish(publishJob, ctx);
    expect(supabase.state.clips[0].external_id).toMatch(/^dryrun_/);
    expect(supabase.state.schedules[0].status).toBe("sent");

    await runPublish(publishJob, ctx);
    expect(supabase.state.schedules[0].status).toBe("sent");
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
      const data = await fs.readFile(localFile, "utf8");
      files.set(`${bucket}/${path}`, data);
    }),
  };
}

function createSupabaseMock() {
  const state = {
    projects: [
      { id: PROJECT_ID, workspace_id: WORKSPACE_ID, status: "uploaded" },
    ],
    clips: [
      {
        id: CLIP_ID,
        project_id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        start_s: 0,
        end_s: 15,
        status: "uploaded",
        storage_path: null,
        thumb_path: null,
        external_id: null,
      },
    ],
    schedules: [
      {
        id: "sched-1",
        clip_id: CLIP_ID,
        provider: "youtube",
        status: "queued",
        sent_at: null,
      },
    ],
  };

  return {
    state,
    from(table: "projects" | "clips" | "schedules") {
      if (table === "clips") {
        return {
          select: () => ({
            eq: (field: keyof (typeof state.clips)[number], value: string) =>
              Promise.resolve({ data: state.clips.filter((clip) => clip[field] === value), error: null }),
          }),
          update: (values: Partial<(typeof state.clips)[number]>) => ({
            eq: (field: keyof (typeof state.clips)[number], value: string) => {
              state.clips.forEach((clip) => {
                if (clip[field] === value) {
                  Object.assign(clip, values);
                }
              });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }

      if (table === "projects") {
        return {
          select: () => ({
            eq: (field: keyof (typeof state.projects)[number], value: string) =>
              Promise.resolve({ data: state.projects.filter((project) => project[field] === value), error: null }),
          }),
          update: (values: Partial<(typeof state.projects)[number]>) => ({
            eq: (field: keyof (typeof state.projects)[number], value: string) => {
              state.projects.forEach((project) => {
                if (project[field] === value) {
                  Object.assign(project, values);
                }
              });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }

      if (table === "schedules") {
        return {
          select: () => ({
            eq: (field: keyof (typeof state.schedules)[number], value: string) =>
              Promise.resolve({ data: state.schedules.filter((schedule) => schedule[field] === value), error: null }),
          }),
          update: (values: Partial<(typeof state.schedules)[number]>) => ({
            eq: (field: keyof (typeof state.schedules)[number], value: string) => {
              state.schedules.forEach((schedule) => {
                if (schedule[field] === value) {
                  Object.assign(schedule, values);
                }
              });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }

      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      };
    },
  } as const;
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


