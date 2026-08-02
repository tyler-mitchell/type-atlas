import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execa } from "execa";

type PackedPackage = {
  name: string;
  version: string;
  files: Array<{ path: string }>;
};

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const packageRequirements = [
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

  const client = new Client({ name: "type-atlas-distribution", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(temporaryDirectory, "node_modules", "@type-atlas", "mcp", "bin", "type-atlas.cjs")],
    cwd: temporaryDirectory,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map(({ name }) => name));
    const missing = ["read_file", "document_symbols", "inspect_symbol"].filter(
      (name) => !names.has(name),
    );
    if (missing.length > 0) {
      throw new Error(`The installed MCP omits tools: ${missing.join(", ")}`);
    }
  } finally {
    await client.close();
  }

  console.log("Packed packages install cleanly and expose the Type Atlas MCP.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
