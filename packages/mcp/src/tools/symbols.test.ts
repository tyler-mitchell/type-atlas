import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import {
  SymbolKind,
  type WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { searchWorkspaceSymbols } from "./symbols.js";

function createWorkspaceSymbol(
  name: string,
  file: string,
  line: number,
  kind = SymbolKind.Function,
  containerName?: string,
): WorkspaceSymbol {
  return {
    name,
    kind,
    containerName,
    location: {
      uri: `file:///repo/${file}`,
      range: {
        start: { line, character: 0 },
        end: { line, character: 10 },
      },
    },
  };
}

function createSessionMock(rootDir: string, workspaceSymbols: WorkspaceSymbol[]): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getProjectFileNames: async () => [],
    getWorkspaceSymbols: async () => workspaceSymbols,
  } as unknown as DiagnosticsSession;
}

describe("searchWorkspaceSymbols", () => {
  it("formats Volar workspace symbol results without re-scanning files", async () => {
    const session = createSessionMock("/repo", [
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
    ]);

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
});
