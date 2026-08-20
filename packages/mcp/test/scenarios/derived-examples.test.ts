import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { renderReadme } from "../../scripts/render-readme.ts";
import { packageRoot } from "./runner.ts";

const repositoryRoot = resolve(packageRoot, "../..");

/**
 * The one-source-of-truth gate: README.md is the rendering of README.mdoc
 * with every embedded scenario response read from the captured files the
 * regression suite maintains. When this fails, a deliberate change
 * regenerated the responses — run
 * `node packages/mcp/scripts/render-readme.ts` and review the README diff —
 * or someone edited README.md directly, which is not theirs to write.
 */
test("README.md is the rendering of README.mdoc with captured responses", async () => {
  const standing = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
  expect(standing).toBe(await renderReadme());
});
