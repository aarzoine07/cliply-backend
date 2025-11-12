// apps/web/vitest.config.ts

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["apps/web/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
    ],
    setupFiles: [resolve(process.cwd(), "packages/shared/test/setup.ts")],
  },
});

