import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

/**
 * The expand contract: one merged tree, subtrees opened deeper in place —
 * a file explorer with folders expanded. Keys are the glob-record convention
 * (lint-staged, tsconfig paths); a number is shorthand for { depth }. The
 * witness pins the call an agent writes on first contact with a monorepo —
 * root shallow, one corner deep — and that the answer is ONE tree whose
 * spine nests, never a second root restating the path.
 */
test("list_files expands a subtree in place inside one tree", async () => {
  const client = new Client({ name: "type-atlas-list-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const expanded = await client.callTool({
      name: "list_files",
      arguments: {
        workspace: workspaceRoot,
        expand: { "packages/core/src/markdoc": { depth: 1, glob: ["*.ts", "*/"] } },
      },
    });
    const text = expanded.content.find((item) => item.type === "text")?.text ?? "";
    // One tree: the workspace root label appears once, and the expanded
    // corner appears as a nested spine, not as a second root path.
    expect(text).toContain("featuretype/");
    expect(text).not.toContain("packages/core/src/markdoc/\n");
    expect(text.split("featuretype/")).toHaveLength(2);
    // The spine nests: each segment its own level, written once.
    expect(text).toMatch(/packages\/\n│ {2}└ {2}core\/\n│ {5}└ {2}src\/\n│ {8}└ {2}markdoc\//u);
    // The expanded corner's contents, filtered by its own glob.
    expect(text).toContain("render.ts");
    expect(text).toContain("documents/");
    // Root stays at the shared default depth: no package internals leak.
    expect(text).not.toContain("workspace-tree.ts");

    // The number shorthand and the unexpanded default both answer.
    const sugar = await client.callTool({
      name: "list_files",
      arguments: {
        workspace: workspaceRoot,
        directory: "packages/core",
        expand: { "src/markdoc": 1 },
      },
    });
    const sugarText = sugar.content.find((item) => item.type === "text")?.text ?? "";
    expect(sugarText).toContain("packages/core/");
    expect(sugarText).toContain("render.ts");

    const plain = await client.callTool({
      name: "list_files",
      arguments: { workspace: workspaceRoot, directory: "packages/core/src/markdoc" },
    });
    const plainText = plain.content.find((item) => item.type === "text")?.text ?? "";
    expect(plainText).toContain("packages/core/src/markdoc/");
    expect(plainText).toContain("documents/");

    // The complete answer, pinned, so the presentation is read rather than
    // asserted around: the exact first-contact call — root shallow, one
    // corner opened — as the tree an agent receives.
    expect(
      (expanded.content.find((item) => item.type === "text")?.text ?? "").replace(
        /\n\n· .+$/u,
        "",
      ),
    ).toMatchInlineSnapshot(`
      "featuretype/
      ├  atlascii/
      ├  docs/
      ├  packages/
      │  └  core/
      │     └  src/
      │        └  markdoc/
      │           ├  documents/
      │           ├  partials/
      │           ├  documents.lint.test.ts
      │           ├  documents.test.ts
      │           └  render.ts
      ├  scripts/
      ├  AGENTS.md
      ├  CONTRIBUTING.md
      ├  LICENSE
      ├  package.json
      ├  pnpm-lock.yaml
      ├  pnpm-workspace.yaml
      ├  README.md
      ├  server.json
      ├  tsconfig.json
      └  tsdown.config.ts"
    `);
  } finally {
    await client.close();
  }
}, 30_000);
