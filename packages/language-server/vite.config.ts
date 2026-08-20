import { defineConfig } from "vite-plus";

export default defineConfig({
  // A package-level vite.config.ts replaces the root's rather than extending
  // it, so the workspace publish contract is restated here — without it,
  // packs silently switch to .mjs and drop the attw and publint gates.
  pack: {
    attw: {
      level: "error",
      profile: "esm-only",
    },
    dts: true,
    fixedExtension: false,
    format: "esm",
    publint: true,
    sourcemap: true,
  },
  run: {
    tasks: {
      // The server tests deliberately spawn the shipped process entrypoint —
      // `bin/type-atlas-language-server.cjs`, which imports `dist/node.js` —
      // so a test run without a fresh build exercises stale code. The old
      // `test` script chained `vp run build && vp test run`; the mandate
      // forbids shell chains, and this edge is the sequencing.
      test: { command: "vp test run", dependsOn: ["build"] },
    },
  },
});
