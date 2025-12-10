// apps/web/vitest.config.ts

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

// ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.test explicitly from the repo root for Vitest
dotenv.config({ path: resolve(__dirname, "../../.env.test") });

export default defineConfig({
  plugins: [tsconfigPaths()],

  resolve: {
    alias: {
      // Explicit aliases for non-src directories (must come before wildcards)
      "@cliply/shared/test": resolve(__dirname, "../../packages/shared/test"),
      "@cliply/shared/logging": resolve(__dirname, "../../packages/shared/logging"),
      "@cliply/shared/billing": resolve(__dirname, "../../packages/shared/billing"),
      "@cliply/shared/types": resolve(__dirname, "../../packages/shared/types"),

      // FORCE Vitest to use TypeScript source for src modules
      "@cliply/shared": resolve(__dirname, "../../packages/shared/src"),
    },
  },

  test: {
    root: resolve(__dirname, "../.."),
    hookTimeout: 60000,
    include: ["apps/web/test/**/*.test.ts"],

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

