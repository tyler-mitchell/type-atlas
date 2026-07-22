import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLanguageServer } from "@volar/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { URI } from "vscode-uri";
import { ReadFileRequest } from "../src/protocol.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
  temporaryRoots.clear();
});

describe("language server", () => {
  it("serves TypeScript and source documents through the Volar process entrypoint", async () => {
    const root = await mkdtemp(path.join(packageRoot, ".language-server-test-"));
    temporaryRoots.add(root);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022" },
      include: ["src/**/*.ts"],
    }));
    const file = path.join(root, "src", "example.ts");
    await writeFile(file, "export const value = 1;\n");

    const handle = startLanguageServer(
      path.join(packageRoot, "bin", "code-intelligence-language-server.cjs"),
      packageRoot,
    );
    try {
      const initialized = await handle.initialize(
        URI.file(root).toString(),
        undefined,
        {
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            hover: {},
          },
        },
      );
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
      expect(symbols).toEqual([
        expect.objectContaining({ name: "value" }),
      ]);
      expect(hover).toMatchObject({
        contents: expect.objectContaining({
          value: expect.stringContaining("const value: 1"),
        }),
      });

      const source = await handle.connection.sendRequest(
        ReadFileRequest.type,
        { uri: document.uri },
      );
      await rm(file);
      expect(source).toBe("export const value = 1;\n");
      expect(
        await handle.connection.sendRequest(ReadFileRequest.type, {
          uri: document.uri,
        }),
      ).toBe(source);
    } finally {
      handle.connection.dispose();
    }
  });
});
