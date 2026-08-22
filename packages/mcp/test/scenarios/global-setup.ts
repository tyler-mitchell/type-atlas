import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execaSync } from "execa";
import type { TestProject } from "vite-plus/test/node";
import { fixtureRoot, packageRoot } from "./fixture.ts";
import { ensureFixtureRepository, removeFixtureRepository } from "./runner.ts";

/**
 * The fixture is a real pnpm workspace, so its cross-package imports resolve
 * through `node_modules` symlinks — the same substrate Type Atlas meets in
 * production repositories. Those links are not committed; a fresh clone gets
 * them here, once per run in the main thread, from the committed lockfile.
 */
const ensureFixtureInstalled = (): void => {
  if (existsSync(resolve(fixtureRoot, "node_modules/@ledger/money"))) return;
  const installed = execaSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: fixtureRoot,
    reject: false,
  });
  if (installed.failed) {
    throw new Error(`Fixture install failed:\n${installed.stdout}\n${installed.stderr}`);
  }
};

/**
 * The fixture's files are versioned by THIS repository, so uncommitted edits
 * to them change tool answers — content, line counts, positions — and a
 * capture accepted from that state baselines a tree no clean checkout can
 * reproduce. (Markers themselves are immune since the fixture carries its
 * own transient repository, but content is not.) Accepting is where the
 * poison enters, so an update run refuses a dirty fixture; a plain run only
 * warns, because iterating against a fixture mid-edit is legitimate. The
 * check addresses the host repository explicitly — from inside the fixture,
 * `git` would answer for the fixture's own transient repository instead.
 */
const ensureFixtureCleanForAccept = (): void => {
  const repositoryRoot = resolve(packageRoot, "../..");
  const status = spawnSync(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain", "--", "fixtures/ledger"],
    { stdio: "pipe", encoding: "utf8" },
  );
  const dirty = status.status === 0 ? status.stdout.trim() : "";
  if (dirty.length === 0) return;
  const updating = process.argv.some((argument) => argument === "-u" || argument === "--update");
  const message = `The fixture has uncommitted changes, and captures embed fixture content:\n${dirty}`;
  if (updating) {
    throw new Error(`${message}\nCommit the fixture before accepting captures (vitest -u).`);
  }
  console.warn(
    `${message}\nFixture-dependent captures will differ until the fixture is committed.`,
  );
};

export default async function setup(project: TestProject) {
  ensureFixtureInstalled();
  ensureFixtureCleanForAccept();
  await ensureFixtureRepository();
  project.onTestsRerun(async () => {
    ensureFixtureInstalled();
    await ensureFixtureRepository();
  });
  return async () => {
    await removeFixtureRepository();
  };
}
