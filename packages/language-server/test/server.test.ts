import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExitNotification } from "@volar/language-server";
import { startLanguageServer } from "@volar/test-utils";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { URI } from "vscode-uri";
import { withEffectLanguageService } from "../src/effect-language-service.ts";
import { ReadFileRequest } from "../src/protocol.ts";

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

describe("language server", () => {
  it("resolves a configured Effect language service from the selected project", async () => {
    const root = await mkdtemp(path.join(packageRoot, ".language-server-test-"));
    temporaryRoots.add(root);
    const file = path.join(root, "effect.ts");
    const configFile = path.join(root, "tsconfig.json");
    await writeFile(file, 'import * as Effect from "effect/Effect";\nEffect.succeed(1);\n');
    const config = {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        plugins: [{ name: "@effect/language-service" }],
        strict: true,
        target: "ES2022",
      },
      files: [file],
    };
    await writeFile(configFile, JSON.stringify(config));
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, configFile);
    const languageService = withEffectLanguageService(ts).createLanguageService({
      fileExists: ts.sys.fileExists,
      getCompilationSettings: () => parsed.options,
      getCurrentDirectory: () => path.parse(packageRoot).root,
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
      const program = languageService.getProgram();
      const sourceFile = program?.getSourceFile(file);
      expect(sourceFile).toBeDefined();
      expect(program?.getSemanticDiagnostics(sourceFile)).toEqual([
        expect.objectContaining({
          messageText: expect.stringMatching(
            /neither yielded nor used in an assignment.*effect\(floatingEffect\)/,
          ),
          source: "effect",
        }),
      ]);
    } finally {
      languageService.dispose();
    }
  });

  it("serves TypeScript and source documents through the Volar process entrypoint", async () => {
    const root = await mkdtemp(path.join(packageRoot, ".language-server-test-"));
    temporaryRoots.add(root);
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022" },
        include: ["src/**/*.ts"],
      }),
    );
    const file = path.join(root, "src", "example.ts");
    await writeFile(file, "export const value = 1;\n");

    const handle = startLanguageServer(
      path.join(packageRoot, "bin", "type-atlas-language-server.cjs"),
      packageRoot,
    );
    try {
      const initialized = await handle.initialize(URI.file(root).toString(), undefined, {
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          hover: {},
        },
      });
      expect(initialized.capabilities).toMatchObject({
        documentSymbolProvider: true,
        hoverProvider: true,
      });

      const document = await handle.openTextDocument(file, "typescript");
      const symbols = await handle.sendDocumentSymbolRequest(document.uri);
      const hover = await handle.sendHoverRequest(document.uri, {
        line: 0,
        character: 13,
      });
      expect(symbols).toEqual([expect.objectContaining({ name: "value" })]);
      expect(hover).toMatchObject({
        contents: expect.objectContaining({
          value: expect.stringContaining("const value: 1"),
        }),
      });

      const source = await handle.connection.sendRequest(ReadFileRequest.type, {
        uri: document.uri,
      });
      await rm(file);
      expect(source).toBe("export const value = 1;\n");
      expect(
        await handle.connection.sendRequest(ReadFileRequest.type, {
          uri: document.uri,
        }),
      ).toBe(source);
    } finally {
      await handle.shutdown();
      const exited = once(handle.process, "exit");
      await handle.connection.sendNotification(ExitNotification.type);
      await exited;
      handle.connection.dispose();
    }
  });
});
