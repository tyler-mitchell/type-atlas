import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vite-plus/test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");
const subject = "packages/core/src/projection.ts";

/**
 * The experimental preflight: what a proposed edit would break, before it is
 * written. A byte-identical proposal must introduce nothing; the same content
 * with one type error appended must report exactly that error, and the file
 * on disk must never change.
 */
test("verify_edit reports what a proposal would introduce, without writing", async () => {
  const client = new Client({ name: "type-atlas-verify-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });
  const source = readFileSync(resolve(workspaceRoot, subject), "utf8");

  await client.connect(transport);
  try {
    const clean = await client.callTool({
      name: "verify_edit",
      arguments: { workspace: workspaceRoot, files: [{ path: subject, content: source }] },
    });
    const cleanText = clean.content.find((item) => item.type === "text")?.text ?? "";
    expect(cleanText).toContain("no problem");

    const broken = await client.callTool({
      name: "verify_edit",
      arguments: {
        workspace: workspaceRoot,
        files: [{ path: subject, content: `${source}\nexport const broken: number = "no";\n` }],
      },
    });
    const brokenText = broken.content.find((item) => item.type === "text")?.text ?? "";
    expect(brokenText).toContain("introduces 1 problem");
    expect(brokenText).toContain("2322");
  } finally {
    await client.close();
  }
  expect(readFileSync(resolve(workspaceRoot, subject), "utf8")).toBe(source);
}, 60_000);
