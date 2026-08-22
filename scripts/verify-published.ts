import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execa } from "execa";

const explain = async (output: string | undefined) => {
  const path = /A complete log of this run can be found in:\s*(\S+)/u.exec(output ?? "")?.[1];
  if (!path) return output ?? "(npm produced no output)";
  const log = await readFile(path, "utf8").catch(() => undefined);
  return log
    ? `${output ?? ""}\n\n--- ${path} (last 60 lines) ---\n${log.split("\n").slice(-60).join("\n")}`
    : (output ?? "(npm produced no output)");
};

const verifyRegistry = async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../packages/mcp/package.json", import.meta.url), "utf8"),
  ) as { name: string; version: string };
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

const verify = async (packageSpec = "@type-atlas/mcp@latest") => {
  const directory = await mkdtemp(join(tmpdir(), "type-atlas-published-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "consumer", private: true }, null, 2)}\n`,
    );
    await writeFile(join(directory, "sample.ts"), "export const value = 1;\n");
    const install = await execa("npm", ["install", packageSpec, "--no-audit", "--no-fund"], {
      cwd: directory,
      all: true,
      reject: false,
    });
    if (install.failed) {
      throw new Error(
        `${packageSpec} does not install from the registry:\n${await explain(install.all)}`,
      );
    }
    if (process.argv[2]) {
      console.log(`${packageSpec} installs from the registry.`);
      return;
    }

    const client = new Client({ name: "type-atlas-production-verifier", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["--yes", packageSpec],
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
      await verifyRegistry();
      console.log(
        `${packageSpec} installs, exposes ${String(tools.length)} tools, serves source, and matches the MCP Registry.`,
      );
    } finally {
      await client.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

await verify(process.argv[2]);
