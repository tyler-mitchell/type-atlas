import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

test("serves workspace files through the packaged stdio entrypoint", async () => {
  const client = new Client({ name: "type-atlas-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/type-atlas.cjs"],
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
      text: expect.stringContaining('"name": "@type-atlas/mcp"'),
    });

    const structure = await client.callTool({
      name: "list_files",
      arguments: {
        workspace: workspaceRoot,
        directory: "packages/mcp/src",
        depth: 1,
        limit: 100,
      },
    });
    expect(structure.content.find((item) => item.type === "text")).toMatchObject({
      type: "text",
      text: expect.stringContaining("  workspace-tree.ts"),
    });

    const filtered = await client.callTool({
      name: "list_files",
      arguments: {
        workspace: workspaceRoot,
        directory: "packages/mcp/src",
        glob: ["**/*.tools.ts", "**/workspace-tree.ts"],
        limit: 100,
      },
    });
    const filteredText = filtered.content.find((item) => item.type === "text")?.text ?? "";
    expect(filteredText).toContain("workspace.tools.ts");
    expect(filteredText).toContain("workspace-tree.ts");
    expect(filteredText).not.toContain("ambient-diagnostics.ts");

    const directories = await client.callTool({
      name: "list_files",
      arguments: {
        workspace: workspaceRoot,
        directory: "packages/mcp",
        depth: 1,
        limit: 100,
        view: "directories",
      },
    });
    expect(directories.content.find((item) => item.type === "text")).toMatchObject({
      type: "text",
      text: expect.stringContaining("src/"),
    });

    const root = await client.callTool({
      name: "list_files",
      arguments: { workspace: workspaceRoot },
    });
    const rootText = root.content.find((item) => item.type === "text")?.text ?? "";
    expect(rootText).toContain("packages/");
    expect(rootText).not.toContain(".github/");
    expect(rootText).not.toContain(".vscode/");

    const hidden = await client.callTool({
      name: "list_files",
      arguments: { workspace: workspaceRoot, includeHidden: true },
    });
    expect(hidden.content.find((item) => item.type === "text")).toMatchObject({
      type: "text",
      text: expect.stringContaining(".github/"),
    });
  } finally {
    await client.close();
  }
}, 30_000);
