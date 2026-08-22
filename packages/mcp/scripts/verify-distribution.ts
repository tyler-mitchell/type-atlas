import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTwoFilesPatch } from "diff";
import { execa } from "execa";
import {
  arrangeFixture,
  capturedScenarios,
  connectScenarioSession,
  ensureFixtureRepository,
  removeFixtureRepository,
  responsesRoot,
  warmFixtureProjects,
} from "../test/scenarios/runner.ts";

type PackedPackage = {
  name: string;
  version: string;
  files: Array<{ path: string }>;
};

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const packageRequirements = [
  {
    directory: "atlascii",
    files: [
      "LICENSE",
      "README.md",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/document/index.d.ts",
      "dist/document/index.js",
    ],
  },
  {
    directory: "packages/language-server",
    files: [
      "LICENSE",
      "README.md",
      "bin/type-atlas-language-server.cjs",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/node.js",
      "dist/protocol.js",
    ],
  },
  {
    directory: "packages/core",
    files: ["LICENSE", "README.md", "dist/index.d.ts", "dist/index.js"],
  },
  {
    directory: "packages/mcp",
    files: [
      "LICENSE",
      "README.md",
      "assets/type-atlas.png",
      "bin/type-atlas.cjs",
      "dist/cli.js",
      "dist/index.d.ts",
      "dist/index.js",
    ],
  },
] as const;

const temporaryDirectory = await mkdtemp(join(tmpdir(), "type-atlas-distribution-"));

const pack = async ({
  directory,
  files,
}: (typeof packageRequirements)[number]): Promise<string> => {
  const tarball = join(temporaryDirectory, `${directory.split("/").at(-1)}.tgz`);
  const { stdout } = await execa(
    "pnpm",
    ["--config.ignore-scripts=true", "pack", "--json", "--out", tarball],
    { cwd: join(repositoryRoot, directory) },
  );
  const packed = JSON.parse(stdout) as PackedPackage;
  const included = new Set(packed.files.map(({ path }) => path));
  const missing = files.filter((path) => !included.has(path));

  if (missing.length > 0) {
    throw new Error(`${packed.name} omits required files: ${missing.join(", ")}`);
  }

  const leaked = [...included].filter(
    (path) => path.startsWith("src/") || path.startsWith("test/"),
  );
  if (leaked.length > 0) {
    throw new Error(`${packed.name} includes private source: ${leaked.join(", ")}`);
  }

  return tarball;
};

try {
  const packageManifest = JSON.parse(
    await readFile(join(repositoryRoot, "packages/mcp/package.json"), "utf8"),
  ) as { mcpName: string; name: string; version: string };
  const serverManifest = JSON.parse(
    await readFile(join(repositoryRoot, "server.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    packages: Array<{ identifier: string; version: string }>;
  };
  const registryPackage = serverManifest.packages.find(
    ({ identifier }) => identifier === packageManifest.name,
  );

  if (
    packageManifest.mcpName !== serverManifest.name ||
    packageManifest.version !== serverManifest.version ||
    packageManifest.version !== registryPackage?.version
  ) {
    throw new Error("package.json and server.json identities or versions differ");
  }

  // The suite publishes as one fixed Bumpy group. A version that differs
  // between packages means versioning did not complete, and publishing would
  // release a split suite. Publication preflight runs from main, where the
  // version pull request has already consumed the bump files, so the pending
  // release plan is empty and cannot carry this check.
  const suite = await Promise.all(
    packageRequirements.map(async ({ directory }) => {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, directory, "package.json"), "utf8"),
      ) as { name: string; version: string };
      return manifest;
    }),
  );
  if (new Set(suite.map(({ version }) => version)).size !== 1) {
    throw new Error(
      `Packages must share one version: ${suite
        .map(({ name, version }) => `${name} ${version}`)
        .join(", ")}`,
    );
  }

  const tarballs = await Promise.all(packageRequirements.map(pack));
  await writeFile(
    join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "type-atlas-consumer", private: true }, null, 2)}\n`,
  );
  await execa("npm", ["install", "--ignore-scripts", ...tarballs], {
    cwd: temporaryDirectory,
  });

  const { stdout: help } = await execa("npm", ["exec", "--offline", "--", "type-atlas", "--help"], {
    cwd: temporaryDirectory,
  });
  if (!help.includes("Run the Type Atlas MCP server over stdio")) {
    throw new Error("The installed type-atlas executable did not render its help");
  }

  // The consumer path must be the product, not a sibling of it: the installed
  // package answers the same tools/list this repository captured, and every
  // committed scenario byte-for-byte. A dist-only regression — a bundling
  // fault, a lost asset, an import that only resolves under development
  // conditions — surfaces here as a named diff instead of in a consumer's
  // session.
  const session = await connectScenarioSession(
    [join(temporaryDirectory, "node_modules", "@type-atlas", "mcp", "bin", "type-atlas.cjs")],
    temporaryDirectory,
  );
  try {
    // The same deterministic environment the capture suite runs in: the
    // fixture's own baseline repository (git markers read it, and arranged
    // index states act on it), and the warm-up, because several answers
    // embed loaded-project state and a cold replay diverges on exactly that.
    await ensureFixtureRepository();
    await warmFixtureProjects(session);
    const capturedCatalog = await readFile(join(responsesRoot, "tool-catalog.json"), "utf8");
    const installedCatalog = `${JSON.stringify(await session.catalog(), null, 2)}\n`;
    if (installedCatalog !== capturedCatalog) {
      throw new Error(
        "The installed MCP's tools/list differs from the captured catalog (test/scenarios/responses/tool-catalog.json). Regenerate captures if the surface changed deliberately.",
      );
    }
    const corpus = await capturedScenarios();
    const mismatched: string[] = [];
    for (const scenario of corpus) {
      // The same working-tree arrangement the capture ran under — a scenario
      // about uncommitted state cannot reproduce against a clean fixture.
      const restore = scenario.arrange ? await arrangeFixture(scenario.arrange) : undefined;
      const answer = await session
        .invoke(scenario.tool, scenario.arguments)
        .finally(async () => await restore?.());
      const committed = await readFile(join(responsesRoot, `${scenario.id}.txt`), "utf8");
      if (answer.trimEnd() !== committed.trimEnd()) {
        mismatched.push(scenario.id);
        console.error(
          createTwoFilesPatch(
            `captured ${scenario.id}`,
            "installed answer",
            `${committed.trimEnd()}\n`,
            `${answer.trimEnd()}\n`,
          ),
        );
      }
    }
    if (mismatched.length > 0) {
      throw new Error(
        `The installed MCP answers ${mismatched.length} scenario(s) differently from the committed captures: ${mismatched.join(", ")}`,
      );
    }
    console.log(
      `Packed packages install cleanly; the installed MCP reproduces the tool catalog and all ${corpus.length} captured scenarios.`,
    );
  } finally {
    await session.close();
    await removeFixtureRepository();
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
