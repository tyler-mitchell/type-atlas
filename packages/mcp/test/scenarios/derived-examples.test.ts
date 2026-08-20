import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { packageRoot } from "./runner.ts";

const repositoryRoot = resolve(packageRoot, "../..");
const responsesRoot = resolve(packageRoot, "test/scenarios/responses");

/**
 * The other half of the one-source-of-truth contract: every scenario example
 * embedded in documentation matches its captured response, byte for byte.
 * When this fails, either a deliberate change regenerated the responses (run
 * `node packages/mcp/scripts/sync-scenario-examples.ts` and review the doc
 * diff) or someone hand-edited an example that is not theirs to write.
 */
const marker = /<!-- scenario:(?<id>[\w/-]+) -->\n```[a-z]*\n(?<body>[\s\S]*?)```\n<!-- \/scenario -->/gu;

for (const relative of ["README.md", "packages/mcp/README.md"]) {
  test(`${relative} examples match captured responses`, async () => {
    const source = await readFile(resolve(repositoryRoot, relative), "utf8").catch(() => "");
    for (const match of source.matchAll(marker)) {
      const { id, body } = match.groups as { id: string; body: string };
      const captured = await readFile(resolve(responsesRoot, `${id}.txt`), "utf8");
      expect(body, `stale example "${id}" in ${relative}`).toBe(`${captured.trimEnd()}\n`);
    }
  });
}
