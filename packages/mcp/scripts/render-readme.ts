/**
 * Renders `README.mdoc` to `README.md`.
 *
 * The source is Markdoc: ordinary GitHub Markdown plus one tag —
 *
 *     {% scenario "diagnostics/deliberately-broken-reconcile" /%}
 *
 * — which embeds the named captured response from
 * `packages/mcp/test/scenarios/responses/<id>.txt` as a fenced code block.
 * Everything outside a tag passes through byte-for-byte, so the authored
 * Markdown is the rendered Markdown; Markdoc's parser finds the tags and
 * rejects any tag or reference that does not exist. One pipeline owns the
 * examples end to end: fixture scenario → captured response → this document.
 *
 * Modes:
 *   node packages/mcp/scripts/render-readme.ts          write README.md
 *   node packages/mcp/scripts/render-readme.ts --check  exit 1 when stale (CI)
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Markdoc from "@markdoc/markdoc";
import { scenarios } from "../test/scenarios/cases.ts";
import { fixtureRoot } from "../test/scenarios/runner.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const responsesRoot = resolve(repositoryRoot, "packages/mcp/test/scenarios/responses");

/** Every generated document: repository front page and the npm landing page. */
export const generatedDocuments = [
  { source: "README.mdoc", target: "README.md" },
  { source: "packages/mcp/README.mdoc", target: "packages/mcp/README.md" },
] as const;

const noticeFor = (source: string) =>
  `<!-- Generated from ${source} by packages/mcp/scripts/render-readme.ts — edit the .mdoc, not this file. -->`;

/**
 * The call as an MCP client presents it: `Type Atlas: <tool title>`, then one
 * `key: value` line per argument — string values bare, everything else as
 * JSON. Both halves derive from captures, never hand-written: the title from
 * the server's own `tools/list` answer (responses/tool-catalog.json), the
 * arguments from the scenario definition that produced the shown response.
 * `workspace` leads every call the way an agent sends it; the fixture is
 * that workspace, named by its repository path rather than an absolute one.
 */
let titlesHeld: Promise<Map<string, string>> | undefined;
const toolTitles = () =>
  (titlesHeld ??= (async () => {
    const catalog = JSON.parse(
      await readFile(resolve(responsesRoot, "tool-catalog.json"), "utf8"),
    ) as ReadonlyArray<{ name: string; title?: string }>;
    return new Map(catalog.map(({ name, title }) => [name, title ?? name]));
  })());

const invocationLines = async (
  tool: string,
  argument: Record<string, unknown>,
): Promise<string> =>
  [
    `tool: ${(await toolTitles()).get(tool) ?? tool}`,
    `workspace: ${relative(repositoryRoot, fixtureRoot)}`,
    ...Object.entries(argument).map(
      ([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    ),
  ].join("\n");

export const renderReadme = async (sourceRelative = "README.mdoc"): Promise<string> => {
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
      const scenario = scenarios.find((held) => `${held.tool}/${held.name}` === id);
      if (scenario === undefined) {
        throw new Error(
          `${sourceRelative} embeds scenario "${id}" (line ${node.lines[0] ?? "?"}) but no such scenario is defined in test/scenarios/cases.ts`,
        );
      }
      const captured = await readFile(resolve(responsesRoot, `${id}.txt`), "utf8").catch(() => {
        throw new Error(
          `${sourceRelative} embeds scenario "${id}" (line ${node.lines[0] ?? "?"}) but no response is captured at test/scenarios/responses/${id}.txt`,
        );
      });
      // The invocation stands in its own fence — visually a call, distinct
      // from the answer under it. Derived invocation text never carries
      // backticks, so a plain fence cannot collide; the response, which can,
      // stays an indented block.
      const invocation = `\`\`\`yaml\n${await invocationLines(scenario.tool, scenario.arguments)}\n\`\`\``;
      // A tag stands on its own line; its line span is replaced whole.
      const [from, to] = [Math.min(...node.lines), Math.max(...node.lines)];
      // Indented code blocks, not fences: a response may carry fences of its
      // own (a hover's ```typescript block), and while CommonMark nests a
      // longer outer fence correctly, real-world renderers close on any
      // fence and invert the rest of the document. Four spaces cannot
      // collide with anything a response says.
      const indented = captured
        .trimEnd()
        .split("\n")
        .map((line) => (line === "" ? line : `    ${line}`))
        .join("\n");
      // The tag's parsed span swallows the blank line after it; the block
      // hands one back so following prose never leans on the code.
      return { from, to, fenced: `${invocation}\n\n${indented}\n` };
    }),
  );
  const lines = source.split("\n");
  const spliced = embeds
    .sort((left, right) => right.from - left.from)
    .reduce((held, embed) => held.toSpliced(embed.from, embed.to - embed.from + 1, embed.fenced), lines);
  return `${noticeFor(sourceRelative)}\n${spliced.join("\n")}`;
};

const executedDirectly = process.argv[1]?.endsWith("render-readme.ts") ?? false;
if (executedDirectly) {
  const stale: string[] = [];
  for (const { source, target } of generatedDocuments) {
    const rendered = await renderReadme(source);
    const path = resolve(repositoryRoot, target);
    const standing = await readFile(path, "utf8").catch(() => "");
    if (rendered === standing) continue;
    stale.push(target);
    if (!process.argv.includes("--check")) {
      await writeFile(path, rendered);
      console.log(`${target} rendered from ${source}.`);
    }
  }
  if (stale.length === 0) {
    console.log("Every generated document is current.");
  } else if (process.argv.includes("--check")) {
    console.error(
      `Stale: ${stale.join(", ")}. Run: node packages/mcp/scripts/render-readme.ts`,
    );
    process.exit(1);
  }
}
