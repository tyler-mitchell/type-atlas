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
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Markdoc from "@markdoc/markdoc";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const responsesRoot = resolve(repositoryRoot, "packages/mcp/test/scenarios/responses");

const notice =
  "<!-- Generated from README.mdoc by packages/mcp/scripts/render-readme.ts — edit the .mdoc, not this file. -->";

export const renderReadme = async (): Promise<string> => {
  const source = await readFile(resolve(repositoryRoot, "README.mdoc"), "utf8");
  const document = Markdoc.parse(source);
  const tags = [...document.walk()].filter((node) => node.type === "tag");
  const unknown = tags.filter((node) => node.tag !== "scenario");
  if (unknown.length > 0) {
    throw new Error(
      `README.mdoc uses tags this renderer does not define: ${unknown
        .map((node) => `{% ${node.tag} %} (line ${node.lines[0] ?? "?"})`)
        .join(", ")}. The one defined tag is {% scenario "<tool>/<name>" /%}.`,
    );
  }
  const embeds = await Promise.all(
    tags.map(async (node) => {
      const id = String(node.attributes.primary ?? "");
      const captured = await readFile(resolve(responsesRoot, `${id}.txt`), "utf8").catch(() => {
        throw new Error(
          `README.mdoc embeds scenario "${id}" (line ${node.lines[0] ?? "?"}) but no response is captured at test/scenarios/responses/${id}.txt`,
        );
      });
      // A tag stands on its own line; its line span is replaced whole.
      const [from, to] = [Math.min(...node.lines), Math.max(...node.lines)];
      // A response may carry fences of its own (a hover's ```typescript
      // block); the embedding fence must outrun the longest inner backtick
      // run or the inner fence closes it and the rest renders as markdown.
      const longestRun = [...captured.matchAll(/`+/gu)].reduce(
        (held, match) => Math.max(held, match[0].length),
        0,
      );
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      return { from, to, fenced: `${fence}\n${captured.trimEnd()}\n${fence}` };
    }),
  );
  const lines = source.split("\n");
  const spliced = embeds
    .sort((left, right) => right.from - left.from)
    .reduce((held, embed) => held.toSpliced(embed.from, embed.to - embed.from + 1, embed.fenced), lines);
  return `${notice}\n${spliced.join("\n")}`;
};

const executedDirectly = process.argv[1]?.endsWith("render-readme.ts") ?? false;
if (executedDirectly) {
  const rendered = await renderReadme();
  const target = resolve(repositoryRoot, "README.md");
  const standing = await readFile(target, "utf8").catch(() => "");
  if (rendered === standing) {
    console.log("README.md is current.");
  } else if (process.argv.includes("--check")) {
    console.error("README.md is stale. Run: node packages/mcp/scripts/render-readme.ts");
    process.exit(1);
  } else {
    await writeFile(target, rendered);
    console.log("README.md rendered from README.mdoc.");
  }
}
