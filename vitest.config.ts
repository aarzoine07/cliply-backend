import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDir, "apps/web/src"),
      "@cliply/shared": resolve(rootDir, "packages/shared/src"),
    },
  },
  test: {
    globals: true,
    include: ["**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
  },
});
