import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { containingGitSubmodule, findGitSubmoduleRoots } from "./git-submodules.ts";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
  temporaryRoots.clear();
});

describe("git submodules", () => {
  it("derives nested workspace boundaries from Git configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "typeatlas-submodules-"));
    temporaryRoots.add(root);
    await writeFile(
      path.join(root, ".gitmodules"),
      `[submodule "vendor/runtime"]
\tpath = vendor/runtime
\turl = https://example.com/runtime.git
`,
    );

    const submodule = path.join(root, "vendor/runtime");
    const roots = await findGitSubmoduleRoots(root);

    expect(roots).toEqual([submodule]);
    expect(containingGitSubmodule(path.join(submodule, "src/index.ts"), roots)).toBe(submodule);
    expect(containingGitSubmodule(path.join(root, "src/index.ts"), roots)).toBeUndefined();
  });
});
