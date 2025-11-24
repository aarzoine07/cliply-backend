import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadYouTubeVideo } from "../../src/services/youtube/download";
import ytDlp from "yt-dlp-exec";

// Mock yt-dlp-exec
vi.mock("yt-dlp-exec", () => ({
  default: vi.fn(),
}));

// Mock logger
vi.mock("@cliply/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("youtube download service", () => {
  const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Create a temp directory for each test
    tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("downloads YouTube video successfully", async () => {
    const mockVideoContent = Buffer.from("fake video content");
    const videoFileName = "video.mp4";
    const videoPath = join(tempDir, videoFileName);

    // Create a mock video file
    await fs.writeFile(videoPath, mockVideoContent);

    // Mock fs.mkdtemp to return our test temp directory
    vi.spyOn(fs, "mkdtemp").mockResolvedValue(tempDir);

    // Mock yt-dlp to simulate successful download
    (ytDlp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      _filename: videoFileName,
      title: "Test Video",
      duration: 120,
    } as unknown);

    // Mock fs.readdir to return our mock file
    vi.spyOn(fs, "readdir").mockResolvedValue([videoFileName]);

    // Mock fs.stat to return file stats
    vi.spyOn(fs, "stat").mockResolvedValue({
      size: mockVideoContent.length,
    } as Awaited<ReturnType<typeof fs.stat>>);

    const result = await downloadYouTubeVideo({
      youtubeUrl: YOUTUBE_URL,
      targetBucket: "videos",
      targetPath: "test/source.mp4",
    });

    expect(result.localPath).toBe(videoPath);
    expect(result.sizeBytes).toBe(mockVideoContent.length);
    expect(ytDlp).toHaveBeenCalledWith(YOUTUBE_URL, expect.objectContaining({
      output: expect.stringContaining("video.%(ext)s"),
      format: expect.any(String),
    }));
  });

  it("handles download failure and cleans up", async () => {
    const downloadError = new Error("Video unavailable");

    // Mock fs.mkdtemp to return our test temp directory
    vi.spyOn(fs, "mkdtemp").mockResolvedValue(tempDir);

    // Mock yt-dlp to throw an error
    (ytDlp as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(downloadError);

    // Mock fs.rm to verify cleanup is called
    const rmSpy = vi.spyOn(fs, "rm").mockResolvedValue(undefined);

    await expect(
      downloadYouTubeVideo({
        youtubeUrl: YOUTUBE_URL,
        targetBucket: "videos",
        targetPath: "test/source.mp4",
      }),
    ).rejects.toThrow("Failed to download YouTube video");

    // Verify cleanup was attempted
    expect(rmSpy).toHaveBeenCalled();
  });

  it("throws error when no video file is found after download", async () => {
    // Mock fs.mkdtemp to return our test temp directory
    vi.spyOn(fs, "mkdtemp").mockResolvedValue(tempDir);

    // Mock yt-dlp to succeed but no file is created (no _filename in response)
    (ytDlp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Test Video",
    } as unknown);

    // Mock fs.readdir to return empty array
    vi.spyOn(fs, "readdir").mockResolvedValue([]);

    await expect(
      downloadYouTubeVideo({
        youtubeUrl: YOUTUBE_URL,
        targetBucket: "videos",
        targetPath: "test/source.mp4",
      }),
    ).rejects.toThrow("No video file found in temp directory");
  });

  it("throws error when downloaded file is empty", async () => {
    const videoFileName = "video.mp4";
    const videoPath = join(tempDir, videoFileName);

    // Create an empty file
    await fs.writeFile(videoPath, Buffer.alloc(0));

    // Mock fs.mkdtemp to return our test temp directory
    vi.spyOn(fs, "mkdtemp").mockResolvedValue(tempDir);

    // Mock yt-dlp to succeed
    (ytDlp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      _filename: videoFileName,
      title: "Test Video",
    } as unknown);

    // Mock fs.readdir to return our mock file
    vi.spyOn(fs, "readdir").mockResolvedValue([videoFileName]);

    // Mock fs.stat to return zero size
    vi.spyOn(fs, "stat").mockResolvedValue({
      size: 0,
    } as Awaited<ReturnType<typeof fs.stat>>);

    await expect(
      downloadYouTubeVideo({
        youtubeUrl: YOUTUBE_URL,
        targetBucket: "videos",
        targetPath: "test/source.mp4",
      }),
    ).rejects.toThrow("Downloaded file is empty");
  });

  it("handles different video file extensions", async () => {
    const extensions = ["mp4", "webm", "mkv"];
    
    for (const ext of extensions) {
      vi.clearAllMocks();
      const videoFileName = `video.${ext}`;
      const videoPath = join(tempDir, videoFileName);
      const mockContent = Buffer.from(`fake ${ext} content`);

      await fs.writeFile(videoPath, mockContent);

      // Mock fs.mkdtemp to return our test temp directory
      vi.spyOn(fs, "mkdtemp").mockResolvedValue(tempDir);

      (ytDlp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        _filename: videoFileName,
        title: "Test Video",
      } as unknown);
      vi.spyOn(fs, "readdir").mockResolvedValue([videoFileName]);
      vi.spyOn(fs, "stat").mockResolvedValue({
        size: mockContent.length,
      } as Awaited<ReturnType<typeof fs.stat>>);

      const result = await downloadYouTubeVideo({
        youtubeUrl: YOUTUBE_URL,
        targetBucket: "videos",
        targetPath: "test/source.mp4",
      });

      expect(result.localPath).toBe(videoPath);
      expect(result.sizeBytes).toBe(mockContent.length);

      // Clean up for next iteration
      await fs.unlink(videoPath).catch(() => {});
    }
  });
});

