import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import {
  type DocumentSymbol,
  type Hover,
  type Location,
  type LocationLink,
  type SignatureHelp,
  SymbolKind,
  type WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import {
  inspectSymbol,
  searchWorkspaceSymbols,
  searchWorkspaceSymbolsAcrossSessions,
} from "./symbols.js";

function createWorkspaceSymbol(
  name: string,
  file: string,
  line: number,
  kind: SymbolKind = SymbolKind.Function,
  containerName?: string,
  character = 0,
): WorkspaceSymbol {
  const symbolName = name.replace(/\(\)$/, "");
  return {
    name,
    kind,
    containerName,
    location: {
      uri: `file:///repo/${file}`,
      range: {
        start: { line, character },
        end: { line, character: character + symbolName.length },
      },
    },
  };
}

function createDocumentSymbol(
  name: string,
  fileLine: number,
  fileCol: number,
  kind: SymbolKind = SymbolKind.Function,
): DocumentSymbol {
  return {
    name,
    kind,
    range: {
      start: { line: fileLine, character: 0 },
      end: { line: fileLine, character: fileCol + name.length },
    },
    selectionRange: {
      start: { line: fileLine, character: fileCol },
      end: { line: fileLine, character: fileCol + name.length },
    },
    children: [],
  };
}

function createLocation(
  file: string,
  line: number,
  character: number,
): Location {
  return {
    uri: `file:///repo/${file}`,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}

function createSessionMock(
  rootDir: string,
  options: {
    workspaceSymbols?: WorkspaceSymbol[];
    fileContent?: string;
    documentSymbols?: DocumentSymbol[];
    hover?: Hover | null;
    signatureHelp?: SignatureHelp | null;
    definitions?: Array<Location | LocationLink>;
    typeDefinitions?: Array<Location | LocationLink>;
    implementations?: Array<Location | LocationLink>;
    references?: Location[];
  } = {},
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getProjectFileNames: async () => [],
    getWorkspaceSymbols: async () => options.workspaceSymbols ?? [],
    getFileContent: () => options.fileContent ?? "export function createClient() {}\n",
    getFileDocumentSymbols: async () => options.documentSymbols ?? [],
    getFileHover: async () => options.hover ?? null,
    getFileSignatureHelp: async () => options.signatureHelp ?? null,
    getFileDefinition: async () => options.definitions ?? [],
    getFileTypeDefinition: async () => options.typeDefinitions ?? [],
    getFileImplementations: async () => options.implementations ?? [],
    getFileReferences: async () => options.references ?? [],
    getFileCallHierarchyItems: async () => [],
    getCallHierarchyOutgoingCalls: async () => [],
  } as unknown as DiagnosticsSession;
}

describe("searchWorkspaceSymbols", () => {
  it("formats Volar workspace symbol results without re-scanning files", async () => {
    const session = createSessionMock("/repo", {
      workspaceSymbols: [
        createWorkspaceSymbol(
          "GithubQueryComposer",
          "apps/web/src/components/github-query-composer.tsx",
          27,
          12,
          "component",
        ),
        createWorkspaceSymbol(
          "analyzeGithubSearchQuery",
          "packages/github-search-query/src/composer.ts",
          867,
        ),
        createWorkspaceSymbol(
          "RepositoryQueryComposerBase",
          "apps/web/src/modules/discovery-workbench/composer.tsx",
          169,
        ),
      ],
    });

    const result = await searchWorkspaceSymbols(session, {
      query: "Github",
      maxResults: 2,
    });

    expect(result.totalSymbols).toBe(3);
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0]?.name).toBe("GithubQueryComposer");
    expect(result.symbols[0]?.containerName).toBe("component");
    expect(result.symbols[1]?.name).toBe("analyzeGithubSearchQuery");
    expect(result.text).toContain('Workspace matches for "Github" (3 results):');
    expect(result.text).toContain("… 1 more symbols omitted");
  });

  it("omits generated workspace symbol paths from the visible result when source files exist", async () => {
    const session = createSessionMock("/repo", {
      workspaceSymbols: [
        createWorkspaceSymbol(
          "defineProgram",
          "core/kbwl/dist/shared/kbwl.255ea827.mjs",
          110,
        ),
        createWorkspaceSymbol(
          "defineProgram",
          "patches/vendor-kbwl/dist/index.js",
          12,
        ),
        createWorkspaceSymbol(
          "defineProgram",
          "core/kbwl/src/utils/cli-utils.ts",
          14,
        ),
      ],
    });

    const result = await searchWorkspaceSymbolsAcrossSessions([session], {
      query: "defineProgram",
      maxResults: 3,
    });

    expect(result.totalSymbols).toBe(3);
    expect(result.omittedGeneratedCount).toBe(2);
    expect(result.symbols.map((symbol) => symbol.location.uri)).toEqual([
      "file:///repo/core/kbwl/src/utils/cli-utils.ts",
    ]);
    expect(result.text).toContain("generated results omitted");
  });

  it("omits redundant self-only implementation and reference sections", async () => {
    const definition = createLocation("src/client.ts", 0, 16);
    const session = createSessionMock("/repo", {
      fileContent: "export function createClient() {}\n",
      documentSymbols: [createDocumentSymbol("createClient", 0, 16)],
      hover: {
        contents: "```typescript\nfunction createClient(): Client\n```",
      },
      definitions: [definition],
      implementations: [definition],
      references: [definition],
    });

    const text = await inspectSymbol(session, {
      file: "src/client.ts",
      query: "createClient",
    });

    expect(text).toContain("Definition:");
    expect(text).not.toContain("Implementations:");
    expect(text).not.toContain("References:");
  });

  it("rejects conflicting selectors instead of silently ignoring query", async () => {
    const text = await inspectSymbol(createSessionMock("/repo"), {
      file: "src/client.ts",
      query: "createClient",
      line: 1,
      col: 1,
    });

    expect(text).toBe("inspect_symbol accepts query or line/col, not both.");
  });

  it("reports ambiguous Volar workspace-symbol matches with positions", async () => {
    const session = createSessionMock("/repo", {
      fileContent: [
        "interface First { execute(): void }",
        "interface Second { execute(): number }",
      ].join("\n"),
      workspaceSymbols: [
        createWorkspaceSymbol("execute()", "src/client.ts", 0, SymbolKind.Method, undefined, 18),
        createWorkspaceSymbol("execute()", "src/client.ts", 1, SymbolKind.Method, undefined, 19),
      ],
    });

    const ambiguous = await inspectSymbol(session, {
      file: "src/client.ts",
      query: "execute",
    });
    expect(ambiguous).toContain('Ambiguous symbol query "execute"');
    expect(ambiguous).toContain("method execute (line 1:19)");
    expect(ambiguous).toContain("method execute (line 2:20)");
    expect(ambiguous).toContain("Use line/col:");
  });

  it("uses the Volar workspace-symbol implementation range for overload source", async () => {
    const implementation: WorkspaceSymbol = {
      name: "calculate",
      kind: SymbolKind.Function,
      location: {
        uri: "file:///repo/src/client.ts",
        range: {
          start: { line: 2, character: 0 },
          end: { line: 4, character: 1 },
        },
      },
    };
    const implementationReference = createLocation("src/client.ts", 2, 16);
    const session = createSessionMock("/repo", {
      fileContent: [
        "export function calculate(value: string): number;",
        "export function calculate(value: number): number;",
        "export function calculate(value: string | number): number {",
        "  return typeof value === \"string\" ? value.length : value;",
        "}",
      ].join("\n"),
      workspaceSymbols: [implementation],
      definitions: [createLocation("src/client.ts", 2, 0)],
      references: [implementationReference],
    });

    const text = await inspectSymbol(session, {
      file: "src/client.ts",
      query: "calculate",
      includeSource: true,
    });

    expect(text).toContain("export function calculate(value: string | number): number {");
    expect(text).not.toContain("Source:\ncalculate — src/client.ts:1:1-1:");
  });
});
