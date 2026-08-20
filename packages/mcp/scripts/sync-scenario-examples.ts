/**
 * Keeps response-based documentation synchronized with the product.
 *
 * A documentation file embeds a captured scenario response between markers:
 *
 *     <!-- scenario:diagnostics/deliberately-broken-reconcile -->
 *     ```
 *     …the captured response…
 *     ```
 *     <!-- /scenario -->
 *
 * The content inside the fence is owned by
 * `packages/mcp/test/scenarios/responses/<id>.txt` — the same file the
 * regression suite compares against — so an example a reader sees is a
 * response the suite actually captured, never hand-written and never stale.
 *
 * Modes:
 *   node scripts/sync-scenario-examples.ts          rewrite drifted examples
 *   node scripts/sync-scenario-examples.ts --check  exit 1 on drift (CI)
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const responsesRoot = resolve(repositoryRoot, "packages/mcp/test/scenarios/responses");

/** Every documentation file allowed to embed scenario responses. */
const documents = ["README.md", "packages/mcp/README.md"];

const marker = /<!-- scenario:(?<id>[\w/-]+) -->\n```(?<fenceTag>[a-z]*)\n(?<body>[\s\S]*?)```\n<!-- \/scenario -->/gu;

const checking = process.argv.includes("--check");

const results = await Promise.all(
  documents.map(async (relative) => {
    const path = resolve(repositoryRoot, relative);
    const source = await readFile(path, "utf8").catch(() => undefined);
    if (source === undefined) return { relative, drifted: [] as string[] };
    const drifted: string[] = [];
    const synchronized = await Array.fromAsync(source.matchAll(marker), async (match) => {
      const { id, fenceTag, body } = match.groups as {
        id: string;
        fenceTag: string;
        body: string;
      };
      const captured = await readFile(resolve(responsesRoot, `${id}.txt`), "utf8").catch(() => {
        throw new Error(
          `${relative} embeds scenario "${id}" but no response is captured at test/scenarios/responses/${id}.txt`,
        );
      });
      const wanted = `${captured.trimEnd()}\n`;
      if (body !== wanted) drifted.push(id);
      return {
        from: match[0],
        to: `<!-- scenario:${id} -->\n\`\`\`${fenceTag}\n${wanted}\`\`\`\n<!-- /scenario -->`,
      };
    });
    const rewritten = synchronized.reduce(
      (text, { from, to }) => text.replace(from, to),
      source,
    );
    if (!checking && rewritten !== source) await writeFile(path, rewritten);
    return { relative, drifted };
  }),
);

const drifted = results.filter(({ drifted }) => drifted.length > 0);
if (drifted.length === 0) {
  console.log("Documentation examples match their captured responses.");
} else if (checking) {
  for (const { relative, drifted: ids } of drifted) {
    console.error(`${relative}: stale examples — ${ids.join(", ")}`);
  }
  console.error("Run: node packages/mcp/scripts/sync-scenario-examples.ts");
  process.exit(1);
} else {
  for (const { relative, drifted: ids } of drifted) {
    console.log(`${relative}: rewrote ${ids.join(", ")}`);
  }
}
