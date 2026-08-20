import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vite-plus/test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

/**
 * The experimental decision-shaped answer: one call weighing a change. The
 * subject is this repository's own central operation, whose uses span
 * packages, so the answer must reach past the declaring project and say how
 * much of the blast radius is tests.
 */
test("impact weighs a change across packages in one answer", async () => {
  const client = new Client({ name: "type-atlas-impact-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "impact",
      arguments: {
        workspace: workspaceRoot,
        file: "packages/core/src/operations.ts",
        position: { line: 117, character: 14 },
      },
    });
    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("Changing createTypeAtlas touches");
    expect(text).toContain("packages/mcp");
    expect(text).toContain("packages/core");
  } finally {
    await client.close();
  }
}, 60_000);
