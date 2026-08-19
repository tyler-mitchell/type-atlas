import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

/**
 * The literal-text answer the semantic tools cannot give: where an exact
 * token occurs, and — the half that drove the tool — an honest zero naming
 * how much was scanned, so "never used" claims in teardown work rest on a
 * proof instead of on ranked non-answers.
 */
test("occurrences finds exact text and proves absence with a scan count", async () => {
  const client = new Client({ name: "type-atlas-occurrences-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const found = await client.callTool({
      name: "occurrences",
      arguments: {
        workspace: workspaceRoot,
        text: "renderComposition",
        directory: "packages/core/src",
      },
    });
    const foundText = found.content.find((item) => item.type === "text")?.text ?? "";
    expect(foundText).toMatch(/"renderComposition" occurs \d+ times in \d+ files/u);
    expect(foundText).toContain("packages/core/src/markdoc/render.ts");
    expect(foundText).toContain("files scanned");

    const absent = await client.callTool({
      name: "occurrences",
      arguments: {
        workspace: workspaceRoot,
        text: "zzThisTokenOccursNowhereAtAll",
        directory: "packages/core/src",
      },
    });
    const absentText = absent.content.find((item) => item.type === "text")?.text ?? "";
    expect(absentText).toContain('Nothing under packages/core/src contains "zzThisTokenOccursNowhereAtAll"');
    expect(absentText).toMatch(/\d+ files scanned/u);
    expect(absentText).toContain("proof a semantic search cannot give");
  } finally {
    await client.close();
  }
}, 60_000);
