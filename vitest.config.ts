import path from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: [path.resolve(__dirname, "../../packages/shared/test/setup.ts")],
    env: {
      DOTENV_CONFIG_PATH: path.resolve(__dirname, "../../.env.test"),
    },
  },
});
