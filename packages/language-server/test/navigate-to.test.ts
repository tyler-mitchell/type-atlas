import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
  temporaryRoots.clear();
});

/**
 * Known failing on the installed platform, deliberately, so it says so when
 * the platform starts answering.
 *
 * The tsgo bridge's program enumerates shell source files — `statements` is
 * empty and the services name table computes empty — and materializes the
 * parsed file only through `getSourceFile(fileName)`. TypeScript's navigate-to
 * walks the shells, so it answers nothing for every query, structurally,
 * while the same file fetched through the accessor holds the name:
 *
 *   getSourceFiles() entry   statements: 0   namedDeclarations: []
 *   getSourceFile(fileName)  statements: 1   namedDeclarations: [computeTotal]
 *
 * `workspace-declarations.ts` therefore reads name tables through the
 * accessor instead of calling `getNavigateToItems`. When this test starts
 * passing, the platform gap is closed upstream and that bypass can be
 * reconsidered.
 */
describe(`getNavigateToItems on typescript ${ts.version}`, () => {
  it.fails("finds a declaration through a plain language service", async () => {
    const root = await mkdtemp(path.join(packageRoot, ".navigate-to-test-"));
    temporaryRoots.add(root);
    await mkdir(path.join(root, "src"));
    const opened = path.join(root, "src", "example.ts");
    const declaring = path.join(root, "src", "other.ts");
    await writeFile(opened, "export const value = 1;\n");
    await writeFile(declaring, "export function computeTotal() {\n  return 1;\n}\n");
    const config = {
      compilerOptions: { strict: true, target: "ES2022" },
      files: [opened, declaring],
    };
    const configFile = path.join(root, "tsconfig.json");
    await writeFile(configFile, JSON.stringify(config));
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, configFile);
    const languageService = ts.createLanguageService({
      fileExists: ts.sys.fileExists,
      getCompilationSettings: () => parsed.options,
      getCurrentDirectory: () => root,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      getDirectories: ts.sys.getDirectories,
      getScriptFileNames: () => parsed.fileNames,
      getScriptSnapshot: (fileName) => {
        const source = ts.sys.readFile(fileName);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: () => "0",
      readDirectory: ts.sys.readDirectory,
      readFile: ts.sys.readFile,
    });

    try {
      expect(languageService.getProgram()?.getSourceFile(declaring)).toBeDefined();
      expect(languageService.getNavigateToItems("computeTotal")).toEqual([
        expect.objectContaining({ name: "computeTotal", fileName: declaring }),
      ]);
    } finally {
      languageService.dispose();
    }
  });
});
