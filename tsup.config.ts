import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["cli/index.ts"],
  format: ["esm"],
  outDir: "dist",
  banner: { js: "#!/usr/bin/env node" },
});
