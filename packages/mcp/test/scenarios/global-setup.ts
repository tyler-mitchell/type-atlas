import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TestProject } from "vitest/node";
import { fixtureRoot } from "./fixture.ts";

/**
 * The fixture is a real pnpm workspace, so its cross-package imports resolve
 * through `node_modules` symlinks — the same substrate Type Atlas meets in
 * production repositories. Those links are not committed; a fresh clone gets
 * them here, once per run in the main thread, from the committed lockfile.
 */
const ensureFixtureInstalled = (): void => {
  if (existsSync(resolve(fixtureRoot, "node_modules/@ledger/money"))) return;
  const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: fixtureRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (installed.status !== 0) {
    throw new Error(`Fixture install failed:\n${installed.stdout}\n${installed.stderr}`);
  }
};

export default function setup(project: TestProject) {
  ensureFixtureInstalled();
  project.onTestsRerun(() => ensureFixtureInstalled());
}
