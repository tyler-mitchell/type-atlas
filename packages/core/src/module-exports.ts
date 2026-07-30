import { ResolveDependencySourceRequest } from "@typeatlas/language-server/protocol";
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionRequest,
  CompletionResolveRequest,
} from "@volar/language-server/protocol.js";
import { readPackageJSON } from "pkg-types";
import { page } from "./projection.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

export type ModuleExportSurface = "runtime" | "all";

export type ModuleExportPage = {
  readonly module: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
  readonly query: string;
  readonly isIncomplete: boolean;
  readonly total: number;
  readonly offset: number;
  readonly items: readonly CompletionItem[];
  readonly subpaths: readonly string[];
  readonly includeDocs: boolean;
  readonly nextOffset?: number;
  readonly resolved?: boolean;
};

const probe = ({
  moduleName,
  path,
  surface,
}: {
  readonly moduleName: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
}) => {
  const access = path.map((segment) => `[${JSON.stringify(segment)}]`).join("");
  if (surface === "runtime") {
    const expression = `__module${access}.`;
    return {
      source: `import * as __module from ${JSON.stringify(moduleName)};\n${expression}`,
      position: { line: 1, character: expression.length },
    };
  }
  const prefix = "import { ";
  return {
    source: `${prefix}} from ${JSON.stringify(moduleName)};`,
    position: { line: 0, character: prefix.length },
  };
};

/**
 * Lists the exports TypeScript exposes to an importing file.
 *
 * Results preserve Volar's completion order. Runtime mode observes namespace
 * members; `all` mode additionally includes type-only exports. Documentation
 * resolution is limited to the returned page.
 *
 * The importing file selects the configured TypeScript project and exact
 * dependency version. Package subpaths come from that resolved package's
 * declared export map.
 */
export const listModuleExports = async ({
  workspace,
  module: moduleName,
  fromFile,
  path,
  surface,
  query,
  offset,
  limit,
  includeDetails,
  includeDocs,
  includeSubpaths,
  signal,
}: {
  readonly workspace: VolarWorkspace;
  readonly module: string;
  readonly fromFile: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
  readonly query: string;
  readonly offset: number;
  readonly limit: number;
  readonly includeDetails: boolean;
  readonly includeDocs: boolean;
  readonly includeSubpaths: boolean;
  readonly signal: AbortSignal;
}): Promise<ModuleExportPage> => {
  const uri = workspace.getWorkspaceUri(fromFile);
  const effectiveSurface = path.length ? "runtime" : surface;
  const { source, position } = probe({
    moduleName,
    path,
    surface: effectiveSurface,
  });
  const resolvedModule = includeSubpaths
    ? await workspace.sendRequest(
        ResolveDependencySourceRequest.type,
        {
          textDocument: { uri },
          moduleName,
        },
        signal,
      )
    : undefined;
  const packageJson = resolvedModule
    ? await readPackageJSON(resolvedModule.resolvedFileName)
    : undefined;
  const exports =
    !path.length && packageJson?.name === moduleName ? packageJson.exports : undefined;
  const subpaths =
    exports && typeof exports === "object" && !Array.isArray(exports)
      ? Object.keys(exports)
          .filter((key) => key.startsWith("./") && key !== "./package.json")
          .map((key) => key.slice(2))
          .filter(Boolean)
      : [];

  return workspace.withTextDocument({
    uri,
    languageId: "typescript",
    source,
    signal,
    task: async (textDocument) => {
      const completion = await workspace.sendRequest(
        CompletionRequest.type,
        { textDocument, position },
        signal,
      );
      const items =
        completion === null ? [] : Array.isArray(completion) ? completion : completion.items;
      const exportItems =
        surface === "all"
          ? items.filter((item) => item.kind !== CompletionItemKind.Keyword)
          : items;
      const normalizedQuery = query.toLocaleLowerCase();
      const matchingItems = normalizedQuery
        ? exportItems.filter((item) =>
            (item.filterText ?? item.label).toLocaleLowerCase().includes(normalizedQuery),
          )
        : exportItems;
      const resultPage = page(matchingItems, offset, limit);
      const selectedItems =
        includeDetails || includeDocs
          ? await Promise.all(
              resultPage.items.map((item) =>
                workspace.sendRequest(CompletionResolveRequest.type, item, signal),
              ),
            )
          : resultPage.items;
      return {
        module: moduleName,
        path,
        surface: effectiveSurface,
        query,
        includeDocs,
        subpaths,
        isIncomplete: Array.isArray(completion) ? false : (completion?.isIncomplete ?? false),
        ...resultPage,
        items: selectedItems,
        resolved: completion !== null,
      };
    },
  });
};
