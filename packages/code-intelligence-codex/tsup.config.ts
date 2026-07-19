import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bridge.ts", "src/runtime.ts", "src/language-server.ts"],
  format: ["cjs"],
  platform: "node",
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["typescript", "vite"],
  noExternal: [/^(?!(?:typescript|vite)(?:\/|$))/],
});
