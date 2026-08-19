import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

/**
 * The platform's two reference paths, told apart.
 *
 * The tsgo bridge routes `findReferences` to its Go-side implementation
 * (`program.findReferencesTsgo`), which answers across unopened files.
 * `getReferencesAtPosition` is the unrouted JS walk: over the bridge's shell
 * source files it answers `undefined`, and in a hosted service a subset —
 * which is why `references-at-position.ts` uses `findReferences`. The second
 * expectation is deliberately failing so it reports when the platform routes
 * the position form too.
 */
describe(`reference paths on typescript ${ts.version}`, () => {
  const scaffold = async () => {
    const root = await mkdtemp(path.join(packageRoot, ".references-test-"));
    temporaryRoots.add(root);
    await mkdir(path.join(root, "src"));
    const declaring = path.join(root, "src", "declaring.ts");
    await writeFile(declaring, "export function computeTotal() {\n  return 1;\n}\n");
    await writeFile(
      path.join(root, "src", "using.ts"),
      'import { computeTotal } from "./declaring";\ncomputeTotal();\n',
    );
    await writeFile(
      path.join(root, "src", "also-using.ts"),
      'import { computeTotal } from "./declaring";\nexport const twice = computeTotal() + computeTotal();\n',
    );
    const config = {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      files: [declaring, path.join(root, "src", "using.ts"), path.join(root, "src", "also-using.ts")],
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
    return { declaring, languageService, offset: "export function ".length };
  };

  it("findReferences answers across unopened files", async () => {
    const { declaring, languageService, offset } = await scaffold();
    try {
      // The bridge reads `program.isTsgoBackedProgram` before synchronizing,
      // so a never-synced service throws; building the program first is the
      // caller's accommodation.
      languageService.getProgram();
      const names = (languageService.findReferences(declaring, offset) ?? [])
        .flatMap((group) => group.references)
        .map((entry) => path.basename(entry.fileName));
      expect([...new Set(names)].sort()).toEqual(["also-using.ts", "declaring.ts", "using.ts"]);
    } finally {
      languageService.dispose();
    }
  });

  it.fails("getReferencesAtPosition answers at all", async () => {
    const { declaring, languageService, offset } = await scaffold();
    try {
      expect(languageService.getReferencesAtPosition(declaring, offset)).toBeDefined();
    } finally {
      languageService.dispose();
    }
  });

  /**
   * A rename's edits must reach every importer, including files nothing has
   * touched. A live rename through the MCP missed exactly the one importer no
   * call had materialized: on this platform `getEditsForFileRename` answers
   * `[]` for unopened importers, which is why `missedSpecifierEdits` exists
   * in the MCP's rename handler. Deliberately failing so it reports when the
   * platform starts walking real files and the compensation can go.
   */
  it.fails("getEditsForFileRename updates every unopened importer", async () => {
    const { declaring, languageService } = await scaffold();
    try {
      languageService.getProgram();
      const edits = languageService.getEditsForFileRename(
        declaring,
        declaring.replace("declaring.ts", "renamed.ts"),
        {},
        undefined,
      );
      const touched = [...new Set(edits.map(({ fileName }) => path.basename(fileName)))].sort();
      expect(touched).toEqual(["also-using.ts", "using.ts"]);
    } finally {
      languageService.dispose();
    }
  });
});
