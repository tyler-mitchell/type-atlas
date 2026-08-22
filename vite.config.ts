import { defineConfig } from "vite-plus";

export default defineConfig({
  // The root workflow graph. Every multi-step workflow is a task whose
  // prerequisites are `dependsOn` edges — Vite+'s own sequencing — because
  // package.json scripts here are single program invocations by mandate:
  // no `&&`, no pipes, no shell composition anywhere (AGENTS.md, Command
  // Mandate). A task name can live in vite.config.ts or package.json but
  // never both, so the names below are absent from the root scripts block.
  run: {
    tasks: {
      build: { command: "vp run -r build" },
      "check-types": { command: "vp run -r check-types", dependsOn: ["build"] },
      "fmt-check": { command: "vp fmt --check ." },
      lint: { command: "vp lint .", dependsOn: ["fmt-check"] },
      "lint-fix": { command: "vp lint --fix ." },
      format: { command: "vp fmt .", dependsOn: ["lint-fix"] },
      check: { command: "vp run -r test", dependsOn: ["lint", "check-types"] },
      // The distribution replay and the release chain do real external work —
      // spawned servers, registry state, publication — so they opt out of the
      // default task caching: a cached "published" is not a publication.
      // Plain `node`, not `vp node`: the vp that executes task and script
      // lines is the workspace .bin shim, which has no `env` subsystem, so
      // `vp node` fails there with "Command 'node' not found". The pinned
      // .node-version runtime strips types natively.
      // Depends on `check`, not `build`, so it never runs beside it: `check`
      // rebuilds each package's dist, and a pack that lands mid-clean reads a
      // package as missing its own entrypoints.
      "check:distribution": {
        command: "node packages/mcp/scripts/verify-distribution.ts",
        cache: false,
        dependsOn: ["check"],
      },
      "release:preflight": {
        command: "changeset status",
        cache: false,
        dependsOn: ["check:distribution"],
      },
      release: { command: "changeset publish", cache: false, dependsOn: ["release:preflight"] },
    },
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    // The fixture is deliberately defective — a broken file is the
    // diagnostics scenarios' subject, an unused import is dedupe's — so
    // linting it can only ever report the corpus working as designed.
    ignorePatterns: ["fixtures/**"],
  },
  // Workspace-wide packaging defaults: packages without their own
  // vite.config.ts (atlascii) resolve this block the way they used to
  // resolve the root tsdown.config.ts. The suite publishes
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
