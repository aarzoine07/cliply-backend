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
      // Explicit aliases for @cliply/shared subpaths
      // These must come before the wildcard @cliply/shared alias
      "@cliply/shared/test": resolve(__dirname, "../../packages/shared/test"),
      "@cliply/shared/logging": resolve(__dirname, "../../packages/shared/logging"), // ✅ Root-level logging dir
      "@cliply/shared/billing": resolve(__dirname, "../../packages/shared/src/billing"),
      "@cliply/shared/types": resolve(__dirname, "../../packages/shared/src/types"),
      "@cliply/shared/health": resolve(__dirname, "../../packages/shared/src/health"),
      "@cliply/shared/readiness": resolve(__dirname, "../../packages/shared/src/readiness"),
      "@cliply/shared/resilience": resolve(__dirname, "../../packages/shared/src/resilience"),
      "@cliply/shared/observability": resolve(__dirname, "../../packages/shared/src/observability"),
      "@cliply/shared/auth": resolve(__dirname, "../../packages/shared/src/auth"),
      "@cliply/shared/idempotency": resolve(__dirname, "../../packages/shared/src/idempotency"),
      "@cliply/shared/crypto": resolve(__dirname, "../../packages/shared/src/crypto"),
      "@cliply/shared/engine": resolve(__dirname, "../../packages/shared/src/engine"),
      "@cliply/shared/pipeline": resolve(__dirname, "../../packages/shared/src/pipeline"),
      "@cliply/shared/storage": resolve(__dirname, "../../packages/shared/src/storage"),
      "@cliply/shared/schemas": resolve(__dirname, "../../packages/shared/src/schemas"),

      // Main alias for root shared imports
      "@cliply/shared": resolve(__dirname, "../../packages/shared/src"),

      // App alias for @/lib/... imports
      "@": resolve(__dirname, "./src"),
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

