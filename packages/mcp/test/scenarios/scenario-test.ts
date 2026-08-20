import { test as baseTest } from "vitest";
import { connectScenarioSession, warmFixtureProjects } from "./runner.ts";

/**
 * The scenario test: `session` is one real stdio server per test file,
 * connected on first use, warmed over every fixture project, and closed by
 * the fixture's own cleanup. The warm-up is load-bearing: several answers
 * embed loaded-project counts, and some engine paths answer false empties
 * against cold projects — without it, captures depended on which scenarios
 * happened to run first, and any `-t` subset diverged from the full suite.
 * This module is for test files only — the runner stays importable by plain
 * scripts (distribution verification), which must not touch `vitest`.
 */
export const scenarioTest = baseTest.extend(
  "session",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const session = await connectScenarioSession();
    onCleanup(() => session.close());
    await warmFixtureProjects(session);
    return session;
  },
);
