import { test as baseTest } from "vitest";
import { connectScenarioSession } from "./runner.ts";

/**
 * The scenario test: `session` is one real stdio server per test file,
 * connected on first use and closed by the fixture's own cleanup. This
 * module is for test files only — the runner stays importable by plain
 * scripts (distribution verification), which must not touch `vitest`.
 */
export const scenarioTest = baseTest.extend(
  "session",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const session = await connectScenarioSession();
    onCleanup(() => session.close());
    return session;
  },
);
