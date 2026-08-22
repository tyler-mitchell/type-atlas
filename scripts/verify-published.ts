import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execa } from "execa";

type PackageManifest = { readonly name: string; readonly version: string };

const packageManifests = await Promise.all(
  [
    "../atlascii/package.json",
    "../packages/core/package.json",
    "../packages/language-server/package.json",
    "../packages/mcp/package.json",
  ].map(
    async (path) =>
      JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as PackageManifest,
  ),
);

const suiteVersion = packageManifests[0]!.version;
if (packageManifests.some(({ version }) => version !== suiteVersion)) {
  throw new Error("Published package manifests are not on one fixed-suite version.");
}

const explain = async (output: string | undefined) => {
  const path = /A complete log of this run can be found in:\s*(\S+)/u.exec(output ?? "")?.[1];
  if (!path) return output ?? "(npm produced no output)";
  const log = await readFile(path, "utf8").catch(() => undefined);
  return log
    ? `${output ?? ""}\n\n--- ${path} (last 60 lines) ---\n${log.split("\n").slice(-60).join("\n")}`
    : (output ?? "(npm produced no output)");
};

const verifyRegistry = async (packageManifest: PackageManifest) => {
  const response = await fetch(
    "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.tyler-mitchell%2Ftype-atlas/versions/latest",
  );
  if (!response.ok) throw new Error(`MCP Registry returned ${String(response.status)}.`);
  const result = (await response.json()) as {
    server?: {
      name: string;
      version: string;
      packages?: Array<{ identifier: string; version?: string }>;
    };
    name?: string;
    version?: string;
    packages?: Array<{ identifier: string; version?: string }>;
  };
  const server = result.server ?? result;
  const registryPackage = server.packages?.find(
    ({ identifier }) => identifier === packageManifest.name,
  );
  if (
    server.name !== "io.github.tyler-mitchell/type-atlas" ||
    server.version !== packageManifest.version ||
    registryPackage?.version !== packageManifest.version
  ) {
    throw new Error("MCP Registry and published package versions differ.");
  }
};

const verifyPublicationMetadata = async () => {
  await Promise.all(
    packageManifests.map(async ({ name, version }) => {
      const registry = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
      );
      if (!registry.ok) throw new Error(`${name}@${version} is missing from npm.`);
      const metadata = (await registry.json()) as {
        dist?: { attestations?: { provenance?: { predicateType?: string } } };
      };
      if (
        metadata.dist?.attestations?.provenance?.predicateType !== "https://slsa.dev/provenance/v1"
      ) {
        throw new Error(`${name}@${version} has no npm provenance attestation.`);
      }

      const tag = `${name}@${version}`;
      const release = await fetch(
        `https://api.github.com/repos/tyler-mitchell/type-atlas/releases/tags/${encodeURIComponent(tag)}`,
        { headers: { accept: "application/vnd.github+json" } },
      );
      if (!release.ok) throw new Error(`GitHub Release ${tag} is missing.`);
      const github = (await release.json()) as { draft?: boolean; tag_name?: string };
      if (github.draft || github.tag_name !== tag)
        throw new Error(`GitHub Release ${tag} is invalid.`);
    }),
  );
};

const verify = async (packageSpec?: string) => {
  const directory = await mkdtemp(join(tmpdir(), "type-atlas-published-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "consumer", private: true }, null, 2)}\n`,
    );
    await writeFile(join(directory, "sample.ts"), "export const value = 1;\n");
    const packageSpecs = packageSpec
      ? [packageSpec]
      : packageManifests.map(({ name, version }) => `${name}@${version}`);
    const install = await execa("npm", ["install", ...packageSpecs, "--no-audit", "--no-fund"], {
      cwd: directory,
      all: true,
      reject: false,
    });
    if (install.failed) {
      throw new Error(
        `${packageSpecs.join(", ")} do not install from the registry:\n${await explain(install.all)}`,
      );
    }
    if (packageSpec) {
      console.log(`${packageSpec} installs from the registry.`);
      return;
    }

    const imported = await execa(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `Promise.all(${JSON.stringify(packageManifests.map(({ name }) => name))}.map((name) => import(name)))`,
      ],
      { cwd: directory, all: true, reject: false },
    );
    if (imported.failed) {
      throw new Error(`Published package imports failed:\n${imported.all ?? "(no output)"}`);
    }

    const client = new Client({ name: "type-atlas-production-verifier", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["--yes", `@type-atlas/mcp@${suiteVersion}`],
      cwd: directory,
      stderr: "pipe",
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const expected = JSON.parse(
        await readFile(
          new URL("../packages/mcp/test/scenarios/responses/tool-catalog.json", import.meta.url),
          "utf8",
        ),
      ) as { name: string }[];
      const names = tools.map(({ name }) => name).sort();
      if (JSON.stringify(names) !== JSON.stringify(expected.map(({ name }) => name).sort())) {
        throw new Error("Published MCP tool names differ from the captured catalog.");
      }
      const result = await client.callTool({
        name: "read_file",
        arguments: { workspace: directory, file: ["sample.ts"], includeDiagnostics: "off" },
      });
      if (!result.content.some((item) => item.type === "text" && item.text.includes("value = 1"))) {
        throw new Error("Published MCP started but read_file did not return the source file.");
      }
      await verifyPublicationMetadata();
      await verifyRegistry(packageManifests.find(({ name }) => name === "@type-atlas/mcp")!);
      console.log(
        `Type Atlas ${suiteVersion} installs, imports, carries npm provenance and GitHub Releases, exposes ${String(tools.length)} MCP tools, serves source, and matches the MCP Registry.`,
      );
    } finally {
      await client.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

await verify(process.argv[2]);
