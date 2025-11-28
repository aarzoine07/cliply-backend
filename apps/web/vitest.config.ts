// apps/web/vitest.config.ts

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [tsconfigPaths()],

  resolve: {
    alias: {
      // Only special-case the test helpers.
      // All other @cliply/shared imports are handled by vite-tsconfig-paths.
      "@cliply/shared/test": resolve(__dirname, "../../packages/shared/test"),
    },
  },

  test: {
    root: resolve(__dirname, "../.."),
    hookTimeout: 60000,
    include: [
      "apps/web/test/**/*.test.ts",
    ],

    setupFiles: ["packages/shared/test/setup.ts"],
    environment: "node",

    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
    ],
  },
});
