import type { SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { StorageAdapter } from "../pipelines/types";

/**
 * Supabase Storage adapter implementation for pipeline use.
 */
export function createStorageAdapter(supabase: SupabaseClient): StorageAdapter {
  return {
    async exists(bucket: string, path: string): Promise<boolean> {
      const { data, error } = await supabase.storage.from(bucket).list(dirname(path), {
        limit: 1000,
        search: path.split("/").pop() ?? "",
      });

      if (error) {
        // If bucket doesn't exist, return false rather than throwing
        if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
          return false;
        }
        throw error;
      }

      const fileName = path.split("/").pop() ?? "";
      return data?.some((file) => file.name === fileName) ?? false;
    },

    async list(bucket: string, prefix: string): Promise<string[]> {
      // Supabase list() expects a folder path (can be empty string for root)
      // If prefix doesn't end with /, we need to list the parent directory
      const folderPath = prefix.endsWith("/") ? prefix : dirname(prefix) || "";
      const searchTerm = prefix.endsWith("/") ? undefined : prefix.split("/").pop() ?? "";

      const { data, error } = await supabase.storage.from(bucket).list(folderPath, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
        search: searchTerm || undefined,
      });

      if (error) {
        // If bucket doesn't exist, return empty array
        if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
          return [];
        }
        throw error;
      }

      // Filter out directories (they have id === null) and return full paths
      const files = (data ?? []).filter((item) => item.id !== null); // id is null for folders
      const prefixWithSlash = prefix.endsWith("/") ? prefix : `${dirname(prefix)}/`;
      return files.map((file) => {
        // If prefix was a file pattern, return just matching files
        if (!prefix.endsWith("/")) {
          return file.name;
        }
        return `${prefixWithSlash}${file.name}`;
      });
    },

    async download(bucket: string, path: string, destination: string): Promise<string> {
      const { data, error } = await supabase.storage.from(bucket).download(path);

      if (error) {
        throw new Error(`Failed to download ${bucket}/${path}: ${error.message}`);
      }

      if (!data) {
        throw new Error(`No data returned for ${bucket}/${path}`);
      }

      // Ensure destination directory exists
      await fs.mkdir(dirname(destination), { recursive: true });

      // Write file to destination
      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(destination, Buffer.from(arrayBuffer));

      return destination;
    },

    async upload(
      bucket: string,
      path: string,
      localFile: string,
      contentType?: string,
    ): Promise<void> {
      const fileData = await fs.readFile(localFile);
      const fileName = path.split("/").pop() ?? "file";

      const { error } = await supabase.storage.from(bucket).upload(path, fileData, {
        contentType: contentType ?? "application/octet-stream",
        upsert: true,
      });

      if (error) {
        throw new Error(`Failed to upload ${bucket}/${path}: ${error.message}`);
      }
    },
  };
}

