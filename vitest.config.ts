import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "apps/web/src"),
      "@cliply/shared/readiness/backendReadiness": resolve(__dirname, "packages/shared/src/readiness/backendReadiness.ts"),
      "@cliply/shared/observability/logging": resolve(__dirname, "packages/shared/src/observability/logging.ts"),
      "@cliply/shared/env": resolve(__dirname, "packages/shared/src/env.ts"),
      "@cliply/shared/billing/planResolution": resolve(__dirname, "packages/shared/billing/planResolution.ts"),
      "@cliply/shared/billing/stripePlanMap": resolve(__dirname, "packages/shared/billing/stripePlanMap.ts"),
      "@cliply/shared/logging/logger": resolve(__dirname, "packages/shared/logging/logger.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: [resolve(__dirname, "./packages/shared/test/setup.ts")],
    env: {
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: resolve(__dirname, "./.env.test"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "json-summary"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
        "**/*.d.ts",
        "**/test/**",
        "**/tests/**",
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "**/scripts/**",
        "**/migrations/**",
        "**/_supabase_cli/**",
      ],
      thresholds: {
        // Global thresholds - start conservative and raise over time
        lines: 60,
        statements: 60,
        branches: 50,
        functions: 60,
      },
    },
  },
});
