// apps/web/vitest.config.ts
// Vitest configuration for web app tests
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: "node",
        include: ["apps/web/test/**/*.test.ts", "test/**/*.test.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/cypress/**",
            "**/.{idea,git,cache,output,temp}/**",
            "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*"
        ]
    }
});
