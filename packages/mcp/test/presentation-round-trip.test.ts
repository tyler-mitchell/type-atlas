import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

/**
 * The settings, through the server a client actually launches.
 *
 * `presentation.test.ts` proves the environment is read; the unit tests prove
 * each style draws what it says. Neither proves the two meet: that a variable
 * named in the environment a client starts the server with reaches the document
 * that renders an answer, across the process boundary and through the resolver.
 *
 * That gap is where a configuration looks live and is not, which is the failure
 * this whole surface has been corrected for twice — a style that is selectable
 * and inert is worse than one that was never offered.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

const answer = async (
  environment: Record<string, string>,
  call: { name: string; arguments: Record<string, unknown> },
) => {
  const client = new Client({ name: "type-atlas-presentation-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/type-atlas.cjs"],
    cwd: packageRoot,
    stderr: "pipe",
    env: { ...process.env, ...environment } as Record<string, string>,
  });
  await client.connect(transport);
  try {
    const result = await client.callTool(call);
    return result.content.find((item) => item.type === "text")?.text ?? "";
  } finally {
    await client.close();
  }
};

/** Nesting, drawn over a directory listing. */
const listing = (environment: Record<string, string>) =>
  answer(environment, {
    name: "list_files",
    arguments: { workspace: workspaceRoot, directory: "packages/mcp/src", depth: 1, limit: 20 },
  });

/** A path, on a tool that names files against the workspace rather than a directory. */
const reading = (environment: Record<string, string>) =>
  answer(environment, {
    name: "read_file",
    arguments: {
      workspace: workspaceRoot,
      file: ["packages/mcp/src/presentation.ts"],
      fold: true,
      includeDiagnostics: "off",
    },
  });

test("draws depth the way the environment asked for", async () => {
  // The same listing, three ways, chosen by one variable the client set before
  // the server started. This is the nesting variant end to end: same data, same
  // composed labels, three presentations.
  const connectors = await listing({ TYPE_ATLAS_GUIDE: "connectors" });
  expect(connectors).toContain("├");

  const indented = await listing({ TYPE_ATLAS_GUIDE: "indent" });
  expect(indented).not.toContain("├");
  expect(indented).not.toContain("└");
  expect(indented).toMatch(/\n {2}\S/);

  const ascii = await listing({ TYPE_ATLAS_GUIDE: "connectors", TYPE_ATLAS_GLYPHS: "ascii" });
  expect(ascii).not.toContain("├");
  expect(ascii).toContain("|-");
}, 60_000);

test("names files the way the environment asked for", async () => {
  // Workspace-relative is the default and needs no variable; absolute is the
  // opt-in. A reader gets one or the other for every path in the answer, not a
  // mixture.
  const relative = await reading({});
  expect(relative).toContain("packages/mcp/src/presentation.ts");
  expect(relative).not.toContain(`${workspaceRoot}/packages/mcp/src/presentation.ts`);

  const absolute = await reading({ TYPE_ATLAS_PATHS: "absolute" });
  expect(absolute).toContain(`${workspaceRoot}/packages/mcp/src/presentation.ts`);
}, 60_000);
