import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vite-plus/test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

/**
 * The experimental decision-shaped answer: one call weighing a change. The
 * subject is this repository's own central operation, so the answer must
 * remain useful without mutating which Volar projects the session has loaded.
 */
test("impact weighs a change without mutating project state", async () => {
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
        position: { line: 107, character: 14 },
      },
    });
    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("Changing createTypeAtlas touches");
    expect(text).toContain("packages/core");
  } finally {
    await client.close();
  }
}, 60_000);
