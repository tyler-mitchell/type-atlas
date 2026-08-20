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

/**
 * The fixture has no git identity of its own — `list_files`' change markers
 * read this repository's status. Captures accepted while fixture files sat
 * uncommitted here therefore baselined `· untracked` rows about files that
 * ship committed, and the documentation repeated the lie until the next
 * clean-tree run failed on it. Accepting is where the poison enters, so an
 * update run refuses a dirty fixture; a plain run only warns, because
 * iterating against a fixture mid-edit is legitimate.
 */
const ensureFixtureCleanForAccept = (): void => {
  const status = spawnSync("git", ["status", "--porcelain", "--", fixtureRoot], {
    cwd: fixtureRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
  const dirty = status.status === 0 ? status.stdout.trim() : "";
  if (dirty.length === 0) return;
  const updating = process.argv.some((argument) => argument === "-u" || argument === "--update");
  const message = `The fixture has uncommitted changes, and list_files captures embed git state:\n${dirty}`;
  if (updating) {
    throw new Error(`${message}\nCommit the fixture before accepting captures (vitest -u).`);
  }
  console.warn(`${message}\nGit-marked captures will differ until the fixture is committed.`);
};

export default function setup(project: TestProject) {
  ensureFixtureInstalled();
  ensureFixtureCleanForAccept();
  project.onTestsRerun(() => ensureFixtureInstalled());
}
