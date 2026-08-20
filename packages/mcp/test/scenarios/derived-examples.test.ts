import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { generatedDocuments, renderReadme } from "../../scripts/render-readme.ts";
import { packageRoot } from "./runner.ts";

const repositoryRoot = resolve(packageRoot, "../..");

/**
 * The one-source-of-truth gate: each generated document is the rendering of
 * its .mdoc source with every embedded scenario — invocation and response —
 * derived from the suite's own definitions and captures. When this fails, a
 * deliberate change regenerated the responses — run
 * `node packages/mcp/scripts/render-readme.ts` and review the document diff —
 * or someone edited the generated file directly, which is not theirs to
 * write.
 */
for (const { source, target } of generatedDocuments) {
  test(`${target} is the rendering of ${source}`, async () => {
    const standing = await readFile(resolve(repositoryRoot, target), "utf8");
    expect(standing).toBe(await renderReadme(source));
  });
}
