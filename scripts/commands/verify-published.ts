import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { execa } from "execa";

const manifest = async (directory: string) =>
  JSON.parse(
    await readFile(new URL(`../../${directory}/package.json`, import.meta.url), "utf8"),
  ) as { name: string; version: string };

/**
 * Installs the just-published server from npm, as a consumer would.
 *
 * The distribution check packs the workspace and installs those tarballs, so
 * every workspace dependency resolves from disk whether or not it exists on
 * the registry. That blind spot shipped a release: three packages went to npm
 * depending on an `atlascii` that had never been published, every gate was
 * green, and the first thing to notice was an install failure. Resolution
 * against the real registry is a different question from packing, and only
 * asking it after the publish answers it.
 */
export default defineCommand({
  meta: {
    name: "verify-published",
    description: "Install the published server from npm and fail if it does not resolve.",
  },
  run: async () => {
    const { name, version } = await manifest("packages/mcp");
    const directory = await mkdtemp(join(tmpdir(), "type-atlas-published-"));
    try {
      await writeFile(
        join(directory, "package.json"),
        `${JSON.stringify({ name: "consumer", private: true }, null, 2)}\n`,
      );
      await execa("npm", ["install", `${name}@${version}`, "--no-audit", "--no-fund"], {
        cwd: directory,
        stdio: "inherit",
      });
      console.log(`${name}@${version} installs from the registry.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});
