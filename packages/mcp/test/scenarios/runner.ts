import { rmSync } from "node:fs";
import { appendFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/**
 * Working-tree state a case needs, applied to the fixture before the
 * invocation and restored — byte-true — after it, whatever happens. Paths
 * are fixture-relative. This exists for behavior that is *about* uncommitted
 * state (git markers); everything else runs against the committed fixture.
 */
export type Arrange = {
  readonly create?: Readonly<Record<string, string>>;
  readonly append?: Readonly<Record<string, string>>;
  readonly delete?: readonly string[];
};

export { fixtureRoot, packageRoot } from "./fixture.ts";
import { fixtureRoot, packageRoot } from "./fixture.ts";

export const responsesRoot = resolve(packageRoot, "test/scenarios/responses");

export type CapturedScenario = {
  /** `<tool>/<case>` — the response lives at `responses/<id>.txt`. */
  readonly id: string;
  readonly name: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly arrange?: Arrange;
};

/**
 * The captured corpus, in execution order. The suite's manifest snapshot
 * names every case it ran, and each case's `.call.json` records the
 * invocation that produced the response beside it — so everything downstream
 * of the suite (documentation, distribution replay) enumerates cases from
 * here, and a case is declared exactly once: in the test that runs it.
 */
export const capturedScenarios = async (): Promise<readonly CapturedScenario[]> => {
  const manifest = await readFile(resolve(responsesRoot, "manifest.txt"), "utf8");
  return Promise.all(
    manifest
      .split("\n")
      .filter(Boolean)
      .map(async (id) => {
        const record = JSON.parse(
          await readFile(resolve(responsesRoot, `${id}.call.json`), "utf8"),
        ) as { tool: string; arguments: Record<string, unknown>; arrange?: Arrange };
        return { id, name: id.slice(id.indexOf("/") + 1), ...record };
      }),
  );
};

/**
 * Files under `responses/` that no current case owns. Vitest never marks a
 * file snapshot obsolete when its test is deleted or renamed, so without
 * this check a retired case's captures would keep feeding the docs forever.
 */
export const orphanedCaptures = async (): Promise<readonly string[]> => {
  const expected = new Set([
    "manifest.txt",
    "tool-catalog.json",
    ...(await capturedScenarios()).flatMap(({ id }) => [`${id}.call.json`, `${id}.txt`]),
  ]);
  const entries = await readdir(responsesRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(responsesRoot, resolve(entry.parentPath, entry.name)))
    .filter((file) => !expected.has(file))
    .sort();
};

/**
 * Loads every fixture project deterministically, so the session's answers do
 * not depend on scenario order: one cheap request into each tsconfig's
 * territory. Sequential on purpose — parallel first-touches raced project
 * construction.
 */
export const warmFixtureProjects = async (session: {
  invoke: (tool: string, argument: Record<string, unknown>) => Promise<string>;
}): Promise<void> => {
  const doorways = [
    "packages/money/src/money.ts",
    "packages/accounts/src/account.ts",
    "packages/reports/src/balance.ts",
    "packages/reconcile/src/drift.ts",
    "packages/importers/src/csv.ts",
    "packages/rules/src/rule.ts",
    "packages/utils/src/index.ts",
    "apps/website/src/counter.ts",
  ];
  for (const file of doorways) {
    await session.invoke("project_config", { file });
  }
};

/**
 * Dirties the fixture per the scenario and returns the restore — run in a
 * `finally`. Restoration is byte-true to the pre-arrange state, NOT to git
 * HEAD: a `git checkout` restore silently reverted uncommitted fixture work
 * the moment a scenario touched the same file. No scenario outcome may leave
 * the fixture different from how it found it.
 */
export const arrangeFixture = async ({
  create = {},
  append = {},
  delete: removed = [],
}: Arrange): Promise<() => Promise<void>> => {
  const touched = [...Object.keys(append), ...removed];
  const originals = new Map(
    await Promise.all(
      touched.map(
        async (relative) => [relative, await readFile(resolve(fixtureRoot, relative))] as const,
      ),
    ),
  );
  for (const [relative, content] of Object.entries(create))
    await writeFile(resolve(fixtureRoot, relative), content);
  for (const [relative, content] of Object.entries(append))
    await appendFile(resolve(fixtureRoot, relative), content);
  for (const relative of removed) await rm(resolve(fixtureRoot, relative));
  return async () => {
    for (const [relative, bytes] of originals)
      await writeFile(resolve(fixtureRoot, relative), bytes);
    for (const relative of Object.keys(create))
      rmSync(resolve(fixtureRoot, relative), { force: true });
  };
};

/**
 * Latency is real but not behavior: the trailing `· 12ms` line — and the
 * ` · 12ms` an ambient summary hangs on its last sentence — change every run,
 * so they leave before a response is compared or published. The trailer line
 * is stripped whole: a slow run extends it with clauses (`· 243ms · 12
 * language-server requests totalling 1.79s · slowest …`), and a pattern
 * anchored to the short form let exactly those runs poison comparisons.
 */
export const normalizeResponse = (text: string): string =>
  text
    .replace(/\n\n· \d+(?:\.\d+)?m?s[^\n]*\s*$/u, "")
    .replace(/^· \d+(?:\.\d+)?m?s[^\n]*\s*$/u, "")
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
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...entrypoint],
    cwd,
    stderr: "pipe",
  });
  await client.connect(transport);
  // The server's stderr is where a dying backend writes its stack. Kept, so
  // a tool error can name its cause instead of just "Connection is disposed".
  const stderrHeld: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderrHeld.push(chunk.toString("utf8"));
    if (stderrHeld.length > 200) stderrHeld.shift();
  });
  return {
    invoke: async (tool, argument) => {
      const result = await client.callTool({
        name: tool,
        arguments: { workspace: fixtureRoot, ...argument },
      });
      const content = result.content as ReadonlyArray<{ type: string; text?: string }>;
      const text = content.find((item) => item.type === "text")?.text ?? "";
      // A tool error must fail the scenario, never become its capture: an
      // error snapshot poisons the baseline and the docs, then self-confirms
      // on every later run. One mid-suite server death did exactly that —
      // "Connection is disposed." was committed as a tool's documentation.
      if (result.isError === true) {
        throw new Error(
          `${tool} answered with a tool error:\n${text}\n\nServer stderr tail:\n${stderrHeld.slice(-40).join("")}`,
        );
      }
      return normalizeResponse(text);
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
