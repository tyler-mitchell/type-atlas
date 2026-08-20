import { defineConfig } from "vitest/config";

/**
 * Three projects, two ordered groups. The scenario suite captures real tool
 * responses against the fixture; the docs project renders every generated
 * document from those captures as file snapshots — `sequence.groupOrder`
 * guarantees it runs after the captures it reads, in any plain `vitest`
 * invocation. Unit tests ride alongside the capture group.
 *
 * One workflow, vitest's own: `vitest` verifies, `vitest -u` regenerates
 * responses and documentation together. In CI, `update` resolves to `none`,
 * so drift fails instead of being rewritten.
 */
export default defineConfig({
  test: {
    // The default reporter surfaces a test's console output only when the
    // test fails — which silenced the capture echo on exactly the runs that
    // matter, the passing `-u` regenerations. Verbose is the terminal
    // reporter that reports passing tests' output (and annotations), so the
    // changed-capture echoes land in the run stream the developing agent is
    // already reading.
    reporters: ["verbose"],
    // The scenario suite exercises the fixture and the tool source through a
    // spawned stdio server, which Vite's module graph cannot see — without
    // these triggers, watch mode would never rerun captures after the edits
    // that change them. (The watcher's reach beyond this package's root
    // depends on the Vite server watching those paths; if a cross-package
    // edit does not trigger, that is the limit hit.)
    watchTriggerPatterns: [
      {
        pattern: /fixtures\/ledger\/(?!.*node_modules).*$/,
        testsToRun: () => "./test/scenarios/scenarios.test.ts",
      },
      {
        pattern: /(?:packages\/(?:mcp|core|language-server)|atlascii)\/src\/.*$/,
        testsToRun: () => "./test/scenarios/scenarios.test.ts",
      },
    ],
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/*.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "scenarios",
          include: ["test/scenarios/scenarios.test.ts"],
          globalSetup: ["test/scenarios/global-setup.ts"],
          sequence: { groupOrder: 0 },
          // Real language-service work over a spawned server; the first case
          // also absorbs the session fixture's whole-fixture warm-up.
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: "docs",
          include: ["test/scenarios/derived-docs.test.ts"],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
