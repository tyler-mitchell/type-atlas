import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { WorkspaceDeclarationsRequest } from "@type-atlas/language-server/protocol";
import {
  DocumentLinkRequest,
  DocumentLinkResolveRequest,
  GetMatchTsConfigRequest,
  SymbolKind,
} from "@volar/language-server/protocol.js";
import { expect, test, vi } from "vite-plus/test";
import { join } from "pathe";
import { createTypeAtlas } from "../src/operations.ts";
import type { VolarWorkspace } from "../src/volar-workspace.ts";

const RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

test("keeps workspace symbol results within source-code files", async () => {
  const root = await mkdtemp(join(tmpdir(), "type-atlas-symbols-"));
  const dependencyRoot = await mkdtemp(join(tmpdir(), "type-atlas-dependency-"));
  await writeFile(join(root, "source.ts"), "export const source = 1;\n");
  await writeFile(join(root, "types.d.ts"), "export interface AuthoredDeclaration {}\n");
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ include: ["*.ts"] }));
  await writeFile(join(dependencyRoot, "index.d.ts"), "export interface Dependency {}\n");
  const uri = (file: string) => pathToFileURL(join(root, file)).toString();
  const sendRequest = vi.fn(async (request) => {
    if (request === GetMatchTsConfigRequest.type) return null;
    // Not `workspace/symbol`: that request carries no document, so Volar
    // resolves no project for it and searches one holding no files.
    if (request === WorkspaceDeclarationsRequest.type) {
      return {
        declarations: [
          {
            name: "TimelineCompositionAtInput",
            kind: SymbolKind.Class,
            location: { uri: uri("source.ts") },
          },
          {
            name: "AuthoredDeclaration",
            kind: SymbolKind.Interface,
            location: { uri: uri("types.d.ts") },
          },
          {
            name: "DependencyDeclaration",
            kind: SymbolKind.Interface,
            location: { uri: pathToFileURL(join(dependencyRoot, "index.d.ts")).toString() },
          },
          {
            name: "## unrelated markdown heading",
            kind: SymbolKind.String,
            location: { uri: "file:///workspace/README.md" },
          },
        ],
        projects: 2,
      };
    }
    throw new Error("Unexpected request");
  });
  const workspace = {
    root,
    getTextDocument: async () => ({ uri: uri("source.ts") }),
    sendRequest,
  } as unknown as VolarWorkspace;

  try {
    const result = await createTypeAtlas(workspace).workspaceSymbols({
      file: "source.ts",
      query: "TimelineCompositionAtInput",
      signal: new AbortController().signal,
    });

    expect(result.symbols?.map(({ name }) => name)).toEqual([
      "TimelineCompositionAtInput",
      "AuthoredDeclaration",
    ]);
    expect(result.projects).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(dependencyRoot, { recursive: true, force: true });
  }
});

test("recovers the resource behind an editor command document link", async () => {
  const folder = "file:///workspace/packages/mcp";
  const command = `command:revealInExplorer?${encodeURIComponent(
    JSON.stringify([
      { $mid: 1, fsPath: "/workspace/packages/mcp", external: folder, scheme: "file" },
    ]),
  )}`;
  const sendRequest = vi.fn(async (request, params) => {
    if (request === DocumentLinkRequest.type) {
      return [
        { range: RANGE, target: "https://example.com" },
        { range: RANGE, data: "folder" },
        { range: RANGE, data: "unrecoverable" },
      ];
    }
    if (request === DocumentLinkResolveRequest.type) {
      const link = params as { data: string };
      return link.data === "folder"
        ? { range: RANGE, target: command }
        : { range: RANGE, target: "command:noArguments" };
    }
    throw new Error("Unexpected request");
  });
  const workspace = {
    getTextDocument: async () => ({ uri: "file:///workspace/README.md" }),
    readTextDocumentUri: async (uri: string) => ({ textDocument: { uri }, source: "# README" }),
    sendRequest,
    withTextDocument: async ({ task }: { task: (document: { uri: string }) => unknown }) =>
      task({ uri: "file:///workspace/README.md" }),
  } as unknown as VolarWorkspace;

  const { links } = await createTypeAtlas(workspace).documentLinks(
    "README.md",
    new AbortController().signal,
  );

  expect(links.map(({ target }) => target)).toEqual(["https://example.com", folder]);
});
