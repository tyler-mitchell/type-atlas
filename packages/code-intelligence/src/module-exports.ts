import {
  ResolveDependencySourceRequest,
} from "@featuretype/code-intelligence-language-server/protocol";
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionRequest,
  CompletionResolveRequest,
  DefinitionRequest,
} from "@volar/language-server/protocol.js";
import { page } from "./projection.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

export type ModuleExportSurface = "runtime" | "all";

export type ModuleExportPage = {
  readonly module: string;
  readonly surface: ModuleExportSurface;
  readonly query: string;
  readonly isIncomplete: boolean;
  readonly total: number;
  readonly offset: number;
  readonly items: readonly CompletionItem[];
  readonly nextOffset?: number;
  readonly resolved?: boolean;
};

const probe = ({
  moduleName,
  surface,
}: {
  readonly moduleName: string;
  readonly surface: ModuleExportSurface;
}) => {
  const prefix = surface === "runtime"
    ? `import * as __module from ${JSON.stringify(moduleName)};\n__module.`
    : "import { ";
  const suffix = surface === "runtime"
    ? ""
    : ` } from ${JSON.stringify(moduleName)};`;
  return {
    source: `${prefix}${suffix}`,
    position: surface === "runtime"
      ? { line: 1, character: "__module.".length }
      : { line: 0, character: prefix.length },
    modulePosition: {
      line: 0,
      character: prefix.indexOf(JSON.stringify(moduleName)) + 1,
    },
  };
};

export const listModuleExports = async (
  {
    workspace,
    module: moduleName,
    fromFile,
    surface,
    query,
    offset,
    limit,
    includeDocs,
    signal,
  }: {
    readonly workspace: VolarWorkspace;
    readonly module: string;
    readonly fromFile?: string;
    readonly surface: ModuleExportSurface;
    readonly query: string;
    readonly offset: number;
    readonly limit: number;
    readonly includeDocs: boolean;
    readonly signal: AbortSignal;
  },
): Promise<ModuleExportPage> => {
  const contextUri = workspace.getWorkspaceUri(
    fromFile ?? ".code-intelligence-context.ts",
  );
  const resolvedModule = fromFile
    ? await workspace.sendRequest(
      ResolveDependencySourceRequest.type,
      {
        textDocument: { uri: contextUri },
        moduleName,
      },
      signal,
    )
    : undefined;
  if (resolvedModule === null) {
    return {
      module: moduleName,
      surface,
      query,
      isIncomplete: false,
      total: 0,
      offset,
      items: [],
      resolved: false,
    };
  }
  const uri = workspace.getWorkspaceUri(".code-intelligence-module-exports.ts");
  const { source, position, modulePosition } = probe({
    moduleName: resolvedModule?.resolvedFileName ?? moduleName,
    surface,
  });

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
      const items = completion === null
        ? []
        : Array.isArray(completion)
        ? completion
        : completion.items;
      const exportItems = surface === "all"
        ? items.filter((item) => item.kind !== CompletionItemKind.Keyword)
        : items;
      const normalizedQuery = query.toLocaleLowerCase();
      const matchingItems = normalizedQuery
        ? exportItems.filter((item) =>
          (item.filterText ?? item.label).toLocaleLowerCase().includes(
            normalizedQuery,
          )
        )
        : exportItems;
      const resultPage = page(matchingItems, offset, limit);
      const selectedItems = includeDocs
        ? await Promise.all(
          resultPage.items.map((item) =>
            workspace.sendRequest(
              CompletionResolveRequest.type,
              item,
              signal,
            )
          ),
        )
        : resultPage.items;
      const definition = matchingItems.length || resolvedModule
        ? undefined
        : await workspace.sendRequest(
          DefinitionRequest.type,
          { textDocument, position: modulePosition },
          signal,
        );

      return {
        module: moduleName,
        surface,
        query,
        isIncomplete: Array.isArray(completion)
          ? false
          : completion?.isIncomplete ?? false,
        ...resultPage,
        items: selectedItems,
        ...(resolvedModule
          ? { resolved: true }
          : definition === undefined
          ? {}
          : { resolved: Array.isArray(definition) ? !!definition.length : true }),
      };
    },
  });
};
