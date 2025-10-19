// apps/web/vitest.config.ts

import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: [path.resolve(__dirname, "../../packages/shared/test/setup.ts")],
  },
});
