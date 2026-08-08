import { readdir, readFile } from "node:fs/promises";

/**
 * Reports where a release currently stands.
 *
 * Reads the repository's working version and pending changesets, then compares
 * them against the published npm versions and the MCP Registry record. The
 * suite publishes as one fixed-version group, so any disagreement between those
 * sources is an interrupted release rather than normal drift.
 */

const packageNames = ["core", "language-server", "mcp"] as const;
const registryUrl =
  "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.tyler-mitchell/type-atlas";
const bumpOrder = ["patch", "minor", "major"] as const;

type Bump = (typeof bumpOrder)[number];

const workingVersions = async () =>
  await Promise.all(
    packageNames.map(async (name) => ({
      name: `@type-atlas/${name}`,
      version: JSON.parse(
        await readFile(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"),
      ).version as string,
    })),
  );

const pendingChangesets = async () => {
  const directory = new URL("../.changeset/", import.meta.url);
  const entries = await readdir(directory);
  const files = entries.filter((entry) => entry.endsWith(".md") && entry !== "README.md");
  const bumps = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(new URL(file, directory), "utf8");
      return bumpOrder.filter((bump) => text.includes(`": ${bump}`));
    }),
  );
  const highest = bumps
    .flat()
    .reduce<Bump | undefined>(
      (winner, bump) =>
        winner === undefined || bumpOrder.indexOf(bump) > bumpOrder.indexOf(winner) ? bump : winner,
      undefined,
    );
  return { count: files.length, bump: highest };
};

const fetchJson = async (url: string) => {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
};

const publishedVersions = async () =>
  await Promise.all(
    packageNames.map(async (name) => {
      const packument = await fetchJson(`https://registry.npmjs.org/@type-atlas%2F${name}/latest`);
      return {
        name: `@type-atlas/${name}`,
        version: (packument as { version?: string } | undefined)?.version,
      };
    }),
  );

const registryVersion = async () => {
  const found = await fetchJson(registryUrl);
  return (found as { servers?: { server?: { version?: string } }[] } | undefined)?.servers?.[0]
    ?.server?.version;
};

const unique = (values: readonly (string | undefined)[]) => [...new Set(values)];

const [working, pending, published, registry] = await Promise.all([
  workingVersions(),
  pendingChangesets(),
  publishedVersions(),
  registryVersion(),
]);

const workingVersion = unique(working.map(({ version }) => version));
const npmVersion = unique(published.map(({ version }) => version));
const suiteVersion = npmVersion.length === 1 ? npmVersion[0] : undefined;

const state =
  workingVersion.length !== 1
    ? "working versions disagree across the suite"
    : npmVersion.length !== 1
      ? "partial publication — npm versions disagree across the suite"
      : registry !== suiteVersion
        ? "interrupted release — the MCP Registry is behind npm"
        : pending.count
          ? `${pending.count} changeset${pending.count === 1 ? "" : "s"} awaiting release`
          : "released and consistent";

console.log(
  [
    "Type Atlas release status",
    "",
    `Working version    ${workingVersion.join(", ")}`,
    `Pending changesets ${pending.count}${pending.bump ? ` · ${pending.bump}` : ""}`,
    "",
    "Published",
    ...published.map(({ name, version }) => `  ${name.padEnd(28)} ${version ?? "unpublished"}`),
    `  ${"MCP Registry".padEnd(28)} ${registry ?? "absent"}`,
    "",
    `State: ${state}`,
  ].join("\n"),
);
