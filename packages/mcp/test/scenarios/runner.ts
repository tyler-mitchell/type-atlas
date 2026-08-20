import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { appendFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Scenario } from "./cases.ts";

export { fixtureRoot, packageRoot } from "./fixture.ts";
import { fixtureRoot, packageRoot } from "./fixture.ts";


/**
 * Dirties the fixture per the scenario and returns the restore — run in a
 * `finally`. Tracked bytes come back via `git checkout`; creations are
 * removed. No scenario outcome may leave the fixture dirty.
 */
export const arrangeFixture = async ({
  create = {},
  append = {},
  delete: removed = [],
}: NonNullable<Scenario["arrange"]>): Promise<() => void> => {
  for (const [relative, content] of Object.entries(create))
    await writeFile(resolve(fixtureRoot, relative), content);
  for (const [relative, content] of Object.entries(append))
    await appendFile(resolve(fixtureRoot, relative), content);
  for (const relative of removed) await rm(resolve(fixtureRoot, relative));
  const tracked = [...Object.keys(append), ...removed];
  return () => {
    if (tracked.length > 0) spawnSync("git", ["-C", fixtureRoot, "checkout", "--", ...tracked]);
    for (const relative of Object.keys(create)) rmSync(resolve(fixtureRoot, relative), { force: true });
  };
};

/**
 * Latency is real but not behavior: the trailing `· 12ms` line — and the
 * ` · 12ms` an ambient summary hangs on its last sentence — change every run,
 * so they leave before a response is compared or published.
 */
export const normalizeResponse = (text: string): string =>
  text
    .replace(/\n\n· \d+(?:\.\d+)?m?s\s*$/u, "")
    .replace(/^· \d+(?:\.\d+)?m?s\s*$/u, "")
    .replace(/ · \d+(?:\.\d+)?m?s\s*$/u, "");

/**
 * One real server, one client, every scenario through the same stdio boundary
 * an agent uses — schema validation, dispatch, and presentation included.
 * The entrypoint is the development source; the distribution suite swaps in
 * the packaged bin without the scenarios changing.
 */
export const connectScenarioSession = async (
  entrypoint: readonly string[] = ["--conditions=development", "src/cli.ts"],
  cwd: string = packageRoot,
): Promise<{
  invoke: (tool: string, argument: Record<string, unknown>) => Promise<string>;
  catalog: () => Promise<ReadonlyArray<{ name: string; title?: string; description?: string }>>;
  close: () => Promise<void>;
}> => {
  const client = new Client({ name: "type-atlas-scenarios", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [...entrypoint],
      cwd,
      stderr: "pipe",
    }),
  );
  return {
    invoke: async (tool, argument) => {
      const result = await client.callTool({
        name: tool,
        arguments: { workspace: fixtureRoot, ...argument },
      });
      const content = result.content as ReadonlyArray<{ type: string; text?: string }>;
      const text = content.find((item) => item.type === "text")?.text ?? "";
      return result.isError === true ? `⚠ tool error\n${normalizeResponse(text)}` : normalizeResponse(text);
    },
    catalog: async () => {
      const { tools } = await client.listTools();
      return tools
        .map(({ name, title, description }) => ({
          name,
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    close: () => client.close(),
  };
};
