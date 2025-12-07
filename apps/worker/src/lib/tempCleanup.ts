import { promises as fs } from 'node:fs';

/**
 * Safely cleans up a temporary directory and all its contents.
 * This is a best-effort operation that won't throw if the directory doesn't exist or deletion fails.
 * 
 * @param path Path to the temporary directory to clean up
 * @param logger Optional logger for recording cleanup attempts
 */
export async function cleanupTempDirSafe(
  path: string,
  logger?: { warn?: (msg: string, ctx?: Record<string, unknown>) => void }
): Promise<void> {
  if (!path || path === '/' || path === '.') {
    // Safety check: never attempt to delete root or current directory
    logger?.warn?.('temp_dir_cleanup_skipped_unsafe_path', { path });
    return;
  }

  try {
    // Check if path exists before attempting delete
    await fs.access(path);
    
    // Recursively delete directory and contents
    await fs.rm(path, { recursive: true, force: true });
  } catch (error) {
    // Don't throw - this is best-effort cleanup
    // ENOENT (file not found) is expected if already cleaned up
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger?.warn?.('temp_dir_cleanup_failed', {
        path,
        error: (error as Error)?.message ?? String(error),
        code,
      });
    }
  }
}

/**
 * Safely cleans up a single temporary file.
 * This is a best-effort operation that won't throw if the file doesn't exist or deletion fails.
 * 
 * @param filePath Path to the temporary file to clean up
 * @param logger Optional logger for recording cleanup attempts
 */
export async function cleanupTempFileSafe(
  filePath: string,
  logger?: { warn?: (msg: string, ctx?: Record<string, unknown>) => void }
): Promise<void> {
  if (!filePath || filePath === '/' || filePath === '.') {
    // Safety check: never attempt to delete root or current directory
    logger?.warn?.('temp_file_cleanup_skipped_unsafe_path', { filePath });
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Don't throw - this is best-effort cleanup
    // ENOENT (file not found) is expected if already cleaned up
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger?.warn?.('temp_file_cleanup_failed', {
        filePath,
        error: (error as Error)?.message ?? String(error),
        code,
      });
    }
  }
}

