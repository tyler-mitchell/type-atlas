import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  // Workspace-wide packaging defaults: packages without their own
  // vite.config.ts (mcp, language-server, atlascii) resolve this block the
  // way they used to resolve the root tsdown.config.ts. The suite publishes
  // ESM-only with declarations, and every pack run is gated by publint and
  // arethetypeswrong so a broken publish surface fails the build, not a
  // consumer.
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
  fmt: {
    ignorePatterns: [
      "AGENTS.md",
      "docs/semble-affordances.md",
      "docs/volar-affordance-evidence.md",
      // Byte-exact artifacts the formatter must never touch: the fixture is a
      // separate workspace whose files are deliberately shaped (a mangled file
      // is format_document's subject, and case positions point into exact
      // lines); the captures corpus and the generated documentation are the
      // byte-true output of their own generators, compared byte-for-byte by
      // the scenario suite and the distribution replay.
      "fixtures/**",
      "packages/mcp/test/scenarios/responses/**",
      "docs/tools/**",
      "README.md",
      "packages/mcp/README.md",
    ],
  },
});
