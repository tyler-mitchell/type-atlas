import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { expect, test } from "vite-plus/test";
import { projectSources } from "../src/project-graph.ts";

test("projectSources returns the configured source corpus", async () => {
  const root = await mkdtemp(join(tmpdir(), "type-atlas-project-sources-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(join(root, "dist", "index.js"), "export const value = 1;\n");
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist" }, include: ["src/**/*.ts"] }),
    );

    expect(projectSources(root)).toEqual([
      { config: "tsconfig.json", files: [join(root, "src", "index.ts")] },
    ]);
    await writeFile(join(root, "src", "next.ts"), "export const next = 2;\n");
    expect(projectSources(root)[0]?.files).toEqual([
      join(root, "src", "index.ts"),
      join(root, "src", "next.ts"),
    ]);
    await mkdir(join(root, "package", "src"), { recursive: true });
    await writeFile(join(root, "package", "src", "index.ts"), "export const added = 3;\n");
    await writeFile(
      join(root, "package", "tsconfig.json"),
      JSON.stringify({ include: ["src/**/*.ts"] }),
    );
    expect(projectSources(root).map(({ config }) => config)).toEqual([
      "package/tsconfig.json",
      "tsconfig.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
