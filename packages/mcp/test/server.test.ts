import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

test("serves workspace files through the packaged stdio entrypoint", async () => {
  const client = new Client({ name: "typeatlas-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/typeatlas.cjs"],
    cwd: packageRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "read_file",
      arguments: {
        workspace: workspaceRoot,
        file: "packages/mcp/package.json",
        fold: false,
        includeDiagnostics: false,
      },
    });
    const content = result.content.find((item) => item.type === "text");

    expect(content).toMatchObject({
      type: "text",
      text: expect.stringContaining('"name": "@typeatlas/mcp"'),
    });
  } finally {
    await client.close();
  }
}, 30_000);
