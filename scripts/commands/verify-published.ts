import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { execa } from "execa";

/**
 * npm's console output for a failed install is often one line pointing at a
 * log file, so an error repeated verbatim says nothing. This follows the
 * pointer and returns what npm actually recorded.
 */
const explain = async (output: string | undefined) => {
  const path = /A complete log of this run can be found in:\s*(\S+)/u.exec(output ?? "")?.[1];
  if (!path) return output ?? "(npm produced no output)";
  const log = await readFile(path, "utf8").catch(() => undefined);
  if (!log) return output ?? "(npm produced no output)";
  return `${output ?? ""}\n\n--- ${path} (last 60 lines) ---\n${log.split("\n").slice(-60).join("\n")}`;
};

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
  args: {
    package: {
      type: "positional",
      required: false,
      description:
        "Package spec to verify instead of the server, for isolating whose dependency tree fails.",
    },
  },
  run: async ({ args }) => {
    const published = await manifest("packages/mcp");
    const spec = args.package ?? `${published.name}@${published.version}`;
    const directory = await mkdtemp(join(tmpdir(), "type-atlas-published-"));
    try {
      await writeFile(
        join(directory, "package.json"),
        `${JSON.stringify({ name: "consumer", private: true }, null, 2)}\n`,
      );
      // `reject: false` and an echoed result, because npm writes its
      // diagnosis to stdout and exits non-zero: letting execa throw on the
      // exit code discarded the only explanation the gate had to offer.
      const install = await execa("npm", ["install", spec, "--no-audit", "--no-fund"], {
        cwd: directory,
        all: true,
        reject: false,
      });
      if (install.failed) {
        throw new Error(
          `${spec} does not install from the registry:\n${await explain(install.all)}`,
        );
      }
      if (args.package) {
        console.log(`${spec} installs from the registry.`);
        return;
      }
      // Resolving is not running. The bin is what a consumer actually starts,
      // and a package can install cleanly with an entrypoint that throws.
      const help = await execa("npx", ["--yes", spec, "--help"], {
        cwd: directory,
        all: true,
        reject: false,
      });
      if (help.failed) {
        throw new Error(`${spec} installs but will not run:\n${await explain(help.all)}`);
      }
      console.log(`${spec} installs from the registry and its executable answers.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});
