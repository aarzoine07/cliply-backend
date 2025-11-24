import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ytDlp from "yt-dlp-exec";

import { logger } from "@cliply/shared/logging/logger";

/**
 * Parameters for downloading a YouTube video.
 */
export interface YouTubeDownloadParams {
  /** YouTube URL (e.g., https://www.youtube.com/watch?v=...) */
  youtubeUrl: string;
  /** Target bucket in Supabase storage */
  targetBucket: string;
  /** Target path within the bucket (e.g., workspaceId/projectId/source.mp4) */
  targetPath: string;
}

/**
 * Result of a YouTube download operation.
 */
export interface YouTubeDownloadResult {
  /** Size of the downloaded file in bytes */
  sizeBytes: number;
  /** Local file path (temporary, caller should clean up) */
  localPath: string;
}

/**
 * Downloads a YouTube video to a local temporary file using yt-dlp.
 * 
 * This downloads the video to a temporary directory and returns the local path.
 * The caller is responsible for cleaning up the temporary file.
 * 
 * @param params Download parameters
 * @returns Download result with local file path and size
 * @throws Error if download fails
 */
export async function downloadYouTubeVideo(
  params: YouTubeDownloadParams,
): Promise<YouTubeDownloadResult> {
  const { youtubeUrl } = params;
  let tempDir: string | null = null;
  let localPath: string | null = null;

  try {
    // Create temporary directory for download
    tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-yt-download-"));
    const outputTemplate = join(tempDir, "video.%(ext)s");

    logger.info("youtube_download_start", {
      url: youtubeUrl,
      tempDir,
    });

    // Download video using yt-dlp
    // Format: bestvideo+bestaudio merged into mp4, or fallback to best
    const result = await ytDlp(youtubeUrl, {
      output: outputTemplate,
      format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noCheckCertificate: false,
      preferFreeFormats: true,
    });

    // yt-dlp returns metadata including _filename
    // The file is downloaded to the temp directory
    // Try to use _filename from result, or find the file in the directory
    let videoFile: string | undefined;
    
    if (result._filename) {
      // Use the filename from the response
      videoFile = result._filename.split("/").pop() ?? result._filename.split("\\").pop();
    }

    // If we don't have a filename from the response, search the directory
    if (!videoFile) {
      const files = await fs.readdir(tempDir);
      videoFile = files.find((file) => {
        const ext = file.split(".").pop()?.toLowerCase();
        return ["mp4", "webm", "mkv", "m4a"].includes(ext ?? "");
      });
    }

    if (!videoFile) {
      throw new Error(
        `No video file found in temp directory after download. Result: ${JSON.stringify(result)}`,
      );
    }

    localPath = join(tempDir, videoFile);

    // Get file size
    const stats = await fs.stat(localPath);
    const sizeBytes = stats.size;

    if (sizeBytes === 0) {
      throw new Error("Downloaded file is empty");
    }

    logger.info("youtube_download_success", {
      url: youtubeUrl,
      localPath,
      sizeBytes,
    });

    return {
      sizeBytes,
      localPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("youtube_download_failed", {
      url: youtubeUrl,
      error: errorMessage,
    });

    // Clean up on error - remove temp directory and all contents
    if (tempDir) {
      try {
        // Remove directory recursively (handles files inside)
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Ignore cleanup errors
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    throw new Error(`Failed to download YouTube video: ${errorMessage}`);
  }
}

/**
 * Extracts video ID from various YouTube URL formats.
 * 
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * 
 * @param url YouTube URL
 * @returns Video ID or null if not found
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // youtube.com/watch?v=VIDEO_ID
    if (hostname.includes("youtube.com")) {
      return urlObj.searchParams.get("v");
    }

    // youtu.be/VIDEO_ID
    if (hostname.includes("youtu.be")) {
      const pathname = urlObj.pathname;
      return pathname.startsWith("/") ? pathname.slice(1) : pathname;
    }

    // youtube.com/embed/VIDEO_ID
    if (hostname.includes("youtube.com") && urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.slice("/embed/".length);
    }

    return null;
  } catch {
    return null;
  }
}

