import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["../../packages/shared/test/setup.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: ["**/node_modules/**"],
    },
  },
});
