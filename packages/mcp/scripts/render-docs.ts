/**
 * Renders every snapshot-derived document from one source of truth.
 *
 * Two kinds of output, one pipeline:
 *
 * - Authored documents (`README.mdoc` → `README.md`, and the npm README):
 *   ordinary Markdown plus one tag, `{% scenario "<tool>/<name>" /%}`, which
 *   embeds the named captured response with the invocation that produced it.
 * - Tool documents (`docs/tools/<tool>.md`, plus an index): one page per
 *   tool, assembled entirely from the captures — the tool's own advertised
 *   description, then every practical case with its invocation and response.
 *   Nothing in them is written by hand.
 *
 * Both derive from the captured corpus the regression suite maintains under
 * `test/scenarios/responses/` — the manifest naming every case in execution
 * order, each case's `.call.json` invocation record, its response, and the
 * captured `tools/list` catalog. Changing a tool's behavior changes its
 * documentation in the same commit, or the gate says so.
 *
 * The scenario suite renders these as vitest file snapshots: `vitest -u`
 * writes them, a plain run fails on drift. There is no separate command.
 */
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Markdoc from "@markdoc/markdoc";
import {
  type CapturedScenario,
  capturedScenarios,
  fixtureRoot,
  responsesRoot,
} from "../test/scenarios/runner.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const toolDocumentsRoot = "docs/tools";

let corpusHeld: Promise<readonly CapturedScenario[]> | undefined;
const corpus = () => (corpusHeld ??= capturedScenarios());

/** Authored documents: repository front page and the npm landing page. */
export const generatedDocuments = [
  { source: "README.mdoc", target: "README.md" },
  { source: "packages/mcp/README.mdoc", target: "packages/mcp/README.md" },
] as const;

const noticeFor = (source: string) =>
  `<!-- Generated from ${source} by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->`;

type CatalogEntry = { name: string; title?: string; description?: string };

let catalogHeld: Promise<ReadonlyArray<CatalogEntry>> | undefined;
const catalog = () =>
  (catalogHeld ??= readFile(resolve(responsesRoot, "tool-catalog.json"), "utf8").then(
    (source) => JSON.parse(source) as ReadonlyArray<CatalogEntry>,
  ));

/**
 * The working-tree state a case arranged before its call, as one yaml
 * comment. Without it, an arranged case reads as if a plain listing of a
 * clean repository produced `R`/`A`/`C` markers — and two cases with
 * identical arguments but different arrangements rendered as the same
 * invocation with contradicting outputs.
 */
const arrangeNote = (arrange: CapturedScenario["arrange"]): string | undefined => {
  if (arrange === undefined) return undefined;
  const base = (file: string) => file.split("/").at(-1) ?? file;
  const staged = new Set(arrange.stage ?? []);
  const parts = [
    ...Object.keys(arrange.append ?? {}).map((file) => `${base(file)} edited`),
    ...Object.keys(arrange.create ?? {}).map(
      (file) => `${base(file)} ${staged.has(file) ? "created and staged" : "created"}`,
    ),
    ...(arrange.stage ?? [])
      .filter((file) => !(file in (arrange.create ?? {})))
      .map((file) => `${base(file)} staged`),
    ...(arrange.delete ?? []).map((file) => `${base(file)} deleted`),
    ...(arrange.renames ?? []).map(({ from, to }) => `${base(from)} renamed to ${base(to)}`),
    ...(arrange.conflict ? [`merge conflict on ${base(arrange.conflict.file)}`] : []),
  ];
  return parts.length === 0 ? undefined : `# working tree arranged: ${parts.join(" · ")}`;
};

/**
 * The call as an MCP client presents it: `tool: <title>`, then one
 * `key: value` line per argument — string values bare, everything else as
 * JSON. Every half derives from captures: the title from the server's own
 * `tools/list` answer, the arguments and arrangement from the `.call.json`
 * record of what actually ran. `workspace` leads every call the way an
 * agent sends it; the fixture is that workspace, named by repository path.
 */
const invocationBlock = async ({ tool, arguments: argument, arrange, elapsed }: CapturedScenario) => {
  const title = (await catalog()).find(({ name }) => name === tool)?.title ?? tool;
  const note = arrangeNote(arrange);
  const lines = [
    `tool: ${title}`,
    `workspace: ${relative(repositoryRoot, fixtureRoot)}`,
    ...(note === undefined ? [] : [note]),
    ...Object.entries(argument).map(
      ([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    ),
    // set apart: cost is a fact about the answer, not an argument
    "",
    `# answered in ${elapsed}`,
  ];
  return `\`\`\`yaml\n${lines.join("\n")}\n\`\`\``;
};

/**
 * Tilde fences, because responses carry backtick fences of their own (a
 * hover's ```typescript block): inside `~~~`, backticks are plain content
 * in every renderer, where a longer backtick fence still inverted one. The
 * tilde run outgrows any tilde run a response might ever contain.
 */
const responseBlock = (captured: string): string => {
  const content = captured.trimEnd();
  const longestRun = [...content.matchAll(/~+/gu)].reduce(
    (held, match) => Math.max(held, match[0].length),
    0,
  );
  const fence = "~".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${content}\n${fence}`;
};

// One case, labelled: what the agent sent, then what came back.
const casePair = async (scenario: CapturedScenario, captured: string): Promise<string> =>
  [
    "**Agent's Input**",
    await invocationBlock(scenario),
    "**Response**",
    responseBlock(captured),
  ].join("\n\n");

const capturedResponse = (id: string, where: string) =>
  readFile(resolve(responsesRoot, `${id}.txt`), "utf8").catch(() => {
    throw new Error(
      `${where} needs scenario "${id}" but no response is captured at test/scenarios/responses/${id}.txt`,
    );
  });

/** One authored .mdoc rendered to Markdown, scenario tags replaced by their cases. */
export const renderAuthored = async (sourceRelative: string): Promise<string> => {
  const source = await readFile(resolve(repositoryRoot, sourceRelative), "utf8");
  const document = Markdoc.parse(source);
  const tags = [...document.walk()].filter((node) => node.type === "tag");
  const unknown = tags.filter((node) => node.tag !== "scenario");
  if (unknown.length > 0) {
    throw new Error(
      `${sourceRelative} uses tags this renderer does not define: ${unknown
        .map((node) => `{% ${node.tag} %} (line ${node.lines[0] ?? "?"})`)
        .join(", ")}. The one defined tag is {% scenario "<tool>/<name>" /%}.`,
    );
  }
  const embeds = await Promise.all(
    tags.map(async (node) => {
      const id = String(node.attributes.primary ?? "");
      const scenario = (await corpus()).find((held) => held.id === id);
      if (scenario === undefined) {
        throw new Error(
          `${sourceRelative} embeds scenario "${id}" (line ${node.lines[0] ?? "?"}) but no such case is in the captured corpus (test/scenarios/responses/manifest.txt)`,
        );
      }
      const captured = await capturedResponse(id, sourceRelative);
      const [from, to] = [Math.min(...node.lines), Math.max(...node.lines)];
      // The tag's parsed span swallows the blank line after it; the block
      // hands one back so following prose never leans on the code.
      return { from, to, block: `${await casePair(scenario, captured)}\n` };
    }),
  );
  const lines = source.split("\n");
  const spliced = embeds
    .sort((left, right) => right.from - left.from)
    .reduce(
      (held, embed) => held.toSpliced(embed.from, embed.to - embed.from + 1, embed.block),
      lines,
    );
  return `${noticeFor(sourceRelative)}\n${spliced.join("\n")}`;
};

const caseHeading = (name: string): string => name.replaceAll("-", " ");

/** One tool's page: its advertised description, then every case it has. */
export const renderToolDocument = async (tool: string): Promise<string> => {
  const own = (await corpus()).filter((scenario) => scenario.tool === tool);
  const description = (await catalog()).find(({ name }) => name === tool)?.description;
  const cases = await Promise.all(
    own.map(async (scenario) => {
      const captured = await capturedResponse(scenario.id, `${toolDocumentsRoot}/${tool}.md`);
      return `## ${caseHeading(scenario.name)}\n\n${await casePair(scenario, captured)}`;
    }),
  );
  return [
    noticeFor("the scenario captures"),
    `# \`${tool}\``,
    ...(description === undefined ? [] : [description]),
    ...cases,
    "",
  ].join("\n\n");
};

/** The directory's index: every documented tool with its case count. */
export const renderToolIndex = async (): Promise<string> => {
  const held = await catalog();
  const counts = Map.groupBy(await corpus(), ({ tool }) => tool);
  const rows = [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tool, cases]) => {
      const title = held.find(({ name }) => name === tool)?.title ?? tool;
      return `| [\`${tool}\`](${tool}.md) | ${title} | ${cases.length} |`;
    });
  return [
    noticeFor("the scenario captures"),
    "# Tool documentation",
    "One page per tool, generated from the scenario suite's captured responses — every case is a real invocation against [`fixtures/ledger`](../../fixtures/ledger/), regression-checked. See [the README](../../README.md#tool-call-results).",
    "| Tool | | Cases |",
    "| :--- | :--- | ---: |",
    ...rows,
    "",
  ].join("\n\n");
};

/** Every generated file this pipeline owns, as {target, render} pairs. */
export const generatedFiles = async (): Promise<
  ReadonlyArray<{ target: string; render: () => Promise<string> }>
> => {
  const tools = [...new Set((await corpus()).map(({ tool }) => tool))].sort();
  return [
    ...generatedDocuments.map(({ source, target }) => ({
      target,
      render: () => renderAuthored(source),
    })),
    ...tools.map((tool) => ({
      target: `${toolDocumentsRoot}/${tool}.md`,
      render: () => renderToolDocument(tool),
    })),
    { target: `${toolDocumentsRoot}/README.md`, render: renderToolIndex },
  ];
};

/** Files in docs/tools/ that no current tool owns — a tool renamed or retired. */
export const staleToolDocuments = async (): Promise<readonly string[]> => {
  const expected = new Set((await generatedFiles()).map(({ target }) => target));
  const standing = await readdir(resolve(repositoryRoot, toolDocumentsRoot)).catch(() => []);
  return standing
    .map((name) => `${toolDocumentsRoot}/${name}`)
    .filter((target) => !expected.has(target));
};

// No CLI: the scenario suite renders these as vitest file snapshots, so
// `vitest -u` writes documentation the same way it writes responses, and a
// plain run diffs both. One workflow, vitest's own.
