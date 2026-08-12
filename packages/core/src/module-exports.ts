import { ResolveDependencySourceRequest } from "@type-atlas/language-server/protocol";
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionRequest,
  CompletionResolveRequest,
  TypeDefinitionRequest,
} from "@volar/language-server/protocol.js";
import { readPackageJSON } from "pkg-types";
import { URI } from "vscode-uri";
import { page } from "./projection.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

export type ModuleExportSurface = "runtime" | "all";

export type ModuleExportPage = {
  readonly module: string;
  readonly type?: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
  readonly query: string;
  readonly isIncomplete: boolean;
  readonly total: number;
  readonly offset: number;
  readonly items: readonly CompletionItem[];
  readonly definitionUris: readonly string[];
  readonly subpaths: readonly string[];
  readonly includeDocs: boolean;
  readonly nextOffset?: number;
  readonly resolved?: boolean;
};

const probe = ({
  moduleName,
  type,
  path,
  surface,
}: {
  readonly moduleName: string;
  readonly type?: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
}) => {
  const access = path.map((segment) => `[${JSON.stringify(segment)}]`).join("");
  if (type) {
    const expression = `__target${access}.`;
    const declarationPrefix = "declare const __target: __module.";
    return {
      source: `import type * as __module from ${JSON.stringify(moduleName)};\n${declarationPrefix}${type};\n${expression}`,
      position: { line: 2, character: expression.length },
      definitionPosition: { line: 1, character: declarationPrefix.length },
    };
  }
  if (surface === "runtime") {
    const expression = `__module${access}.`;
    const importSource = `import * as __module from ${JSON.stringify(moduleName)};`;
    const finalSegment = path.at(-1);
    return {
      source: `${importSource}\n${expression}`,
      position: { line: 1, character: expression.length },
      definitionPosition: finalSegment
        ? { line: 1, character: expression.lastIndexOf(JSON.stringify(finalSegment)) + 1 }
        : { line: 1, character: 1 },
    };
  }
  const prefix = "import { ";
  const source = `${prefix}} from ${JSON.stringify(moduleName)};`;
  return {
    source,
    position: { line: 0, character: prefix.length },
    definitionPosition: {
      line: 0,
      character: source.indexOf(JSON.stringify(moduleName)) + 1,
    },
  };
};

/**
 * Lists the exports TypeScript exposes to an importing file.
 *
 * Results preserve Volar's completion order. Runtime mode observes namespace
 * members; `all` mode additionally includes type-only exports. Documentation
 * resolution is limited to the returned page. Explicit labels filter the
 * completion page before resolution.
 *
 * The importing file selects the configured TypeScript project and exact
 * dependency version. Package subpaths come from that resolved package's
 * declared export map.
 */
export const listModuleExports = async ({
  workspace,
  module: moduleName,
  fromFile,
  type,
  path,
  surface,
  query,
  labels = [],
  offset,
  limit,
  includeDetails,
  includeDocs,
  includeSubpaths,
  includeDefinition = false,
  signal,
}: {
  readonly workspace: VolarWorkspace;
  readonly module: string;
  readonly fromFile: string;
  readonly type?: string;
  readonly path: readonly string[];
  readonly surface: ModuleExportSurface;
  readonly query: string;
  readonly labels?: readonly string[];
  readonly offset: number;
  readonly limit: number;
  readonly includeDetails: boolean;
  readonly includeDocs: boolean;
  readonly includeSubpaths: boolean;
  readonly includeDefinition?: boolean;
  readonly signal: AbortSignal;
}): Promise<ModuleExportPage> => {
  const uri = workspace.getWorkspaceUri(fromFile);
  const parsedUri = URI.parse(uri);
  // The probe sits beside the importing file so module specifiers resolve
  // against that file's project and package versions. Its name is derived from
  // that file rather than made unique per call: TypeScript retains what it has
  // seen, so a fresh name each time leaves another synthetic source file in the
  // project and the server grows by one per call. A stable name is an ordinary
  // edit to one file, and `withTextDocument` serializes callers sharing it.
  const probeUri = parsedUri.with({ path: `${parsedUri.path}.type-atlas-probe.ts` }).toString();
  const effectiveSurface = type || path.length ? "runtime" : surface;
  const { source, position, definitionPosition } = probe({
    moduleName,
    type,
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
    !type && !path.length && packageJson?.name === moduleName ? packageJson.exports : undefined;
  const subpaths =
    exports && typeof exports === "object" && !Array.isArray(exports)
      ? Object.keys(exports)
          .filter((key) => key.startsWith("./") && key !== "./package.json")
          .map((key) => key.slice(2))
          .filter(Boolean)
      : [];

  return workspace.withTextDocument({
    uri: probeUri,
    languageId: "typescript",
    source,
    signal,
    task: async (textDocument) => {
      const [completion, definitions] = await Promise.all([
        workspace.sendRequest(CompletionRequest.type, { textDocument, position }, signal),
        includeDefinition
          ? workspace.sendRequest(
              TypeDefinitionRequest.type,
              { textDocument, position: definitionPosition },
              signal,
            )
          : undefined,
      ]);
      const items =
        completion === null ? [] : Array.isArray(completion) ? completion : completion.items;
      const exportItems =
        surface === "all"
          ? items.filter((item) => item.kind !== CompletionItemKind.Keyword)
          : items;
      const normalizedQuery = query.toLocaleLowerCase();
      const queriedItems = normalizedQuery
        ? exportItems.filter((item) =>
            (item.filterText ?? item.label).toLocaleLowerCase().includes(normalizedQuery),
          )
        : exportItems;
      const matchingItems = labels.length
        ? queriedItems.filter((item) => labels.includes(item.label))
        : queriedItems;
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
        type,
        path,
        surface: effectiveSurface,
        query,
        includeDocs,
        definitionUris:
          definitions === undefined || definitions === null
            ? []
            : (Array.isArray(definitions) ? definitions : [definitions]).map((definition) =>
                "uri" in definition ? definition.uri : definition.targetUri,
              ),
        subpaths,
        isIncomplete: Array.isArray(completion) ? false : (completion?.isIncomplete ?? false),
        ...resultPage,
        items: selectedItems,
        resolved: completion !== null,
      };
    },
  });
};
