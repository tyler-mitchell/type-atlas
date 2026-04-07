import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enumerateProjectFiles } from "../src/index.js";

describe("enumerateProjectFiles", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("includes files from referenced tsconfig roots", async () => {
    tempDir = await mkdtemp(
      path.join(os.tmpdir(), "featuretype-language-server-project-files-"),
    );

    const projectRoot = path.join(tempDir, "apps", "web");
    await mkdir(path.join(projectRoot, "src"), { recursive: true });

    await writeFile(
      path.join(projectRoot, "tsconfig.json"),
      JSON.stringify(
        {
          files: [],
          references: [{ path: "./tsconfig.app.json" }],
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(projectRoot, "tsconfig.app.json"),
      JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(projectRoot, "src", "router.ts"),
      "const broken: string = 1;\nexport { broken };\n",
    );

    const files = enumerateProjectFiles(projectRoot);

    expect(files).toContain(path.join(projectRoot, "src", "router.ts"));
  });
});
