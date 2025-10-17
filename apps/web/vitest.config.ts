import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["@cliply/shared/test/setup.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: ["**/node_modules/**"],
    },
  },
});
