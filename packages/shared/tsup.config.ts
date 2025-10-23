import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/logging.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
