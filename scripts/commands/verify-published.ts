import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { defineCommand } from "citty";
import { execa } from "execa";

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

export default defineCommand({
  meta: {
    name: "verify-published",
    description: "Install and exercise the published MCP through its production stdio command.",
  },
  args: {
    package: {
      type: "positional",
      required: false,
      description: "Package spec to verify instead of the server.",
    },
  },
  run: async ({ args }) => {
    const published = await manifest("packages/mcp");
    const spec = args.package ?? `${published.name}@latest`;
    const directory = await mkdtemp(join(tmpdir(), "type-atlas-published-"));
    try {
      await writeFile(
        join(directory, "package.json"),
        `${JSON.stringify({ name: "consumer", private: true }, null, 2)}\n`,
      );
      await writeFile(join(directory, "sample.ts"), "export const value = 1;\n");
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
      const transport = new StdioClientTransport({
        command: "npx",
        args: ["--yes", spec],
        cwd: directory,
        stderr: "pipe",
      });
      const client = new Client({ name: "type-atlas-production-verifier", version: "1.0.0" });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        const expected = JSON.parse(
          await readFile(
            new URL(
              "../../packages/mcp/test/scenarios/responses/tool-catalog.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ) as { name: string }[];
        const names = tools.map(({ name }) => name).sort();
        const expectedNames = expected.map(({ name }) => name).sort();
        if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
          throw new Error("Published MCP tool names differ from the captured catalog.");
        }
        const result = await client.callTool({
          name: "read_file",
          arguments: { workspace: directory, file: ["sample.ts"], includeDiagnostics: "off" },
        });
        if (
          !result.content.some((item) => item.type === "text" && item.text.includes("value = 1"))
        ) {
          throw new Error("Published MCP started but read_file did not return the source file.");
        }
        console.log(`${spec} installs, exposes ${String(tools.length)} tools, and serves source.`);
      } finally {
        await client.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});
