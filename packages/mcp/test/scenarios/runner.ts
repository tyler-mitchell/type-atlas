import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The realistic monorepo every scenario runs against. See its README. */
export const fixtureRoot = resolve(packageRoot, "../../fixtures/ledger");

/**
 * The fixture is a real pnpm workspace, so its cross-package imports resolve
 * through `node_modules` symlinks — the same substrate Type Atlas meets in
 * production repositories. Those links are not committed; a fresh clone gets
 * them here, from the committed lockfile, before the first scenario runs.
 */
export const ensureFixtureInstalled = (): void => {
  if (existsSync(resolve(fixtureRoot, "node_modules/@ledger/money"))) return;
  const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: fixtureRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (installed.status !== 0) {
    throw new Error(`Fixture install failed:\n${installed.stdout}\n${installed.stderr}`);
  }
};

/**
 * Latency is real but not behavior: the trailing `· 12ms` line changes every
 * run, so it leaves before a response is compared or published.
 */
export const normalizeResponse = (text: string): string =>
  text.replace(/\n\n· \d+(?:\.\d+)?m?s$/u, "").replace(/^· \d+(?:\.\d+)?m?s$/u, "");

/**
 * One real server, one client, every scenario through the same stdio boundary
 * an agent uses — schema validation, dispatch, and presentation included.
 * The entrypoint is the development source; the distribution suite swaps in
 * the packaged bin without the scenarios changing.
 */
export const connectScenarioSession = async (
  entrypoint: readonly string[] = ["--conditions=development", "src/cli.ts"],
): Promise<{
  invoke: (tool: string, argument: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}> => {
  const client = new Client({ name: "type-atlas-scenarios", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [...entrypoint],
      cwd: packageRoot,
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
    close: () => client.close(),
  };
};
