import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: [path.resolve(__dirname, "../../packages/shared/test/setup.ts")],
  },
});
