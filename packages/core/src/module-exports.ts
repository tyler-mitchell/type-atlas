import { probeMarker, ResolveDependencySourceRequest } from "@type-atlas/language-server/protocol";
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionRequest,
  CompletionResolveRequest,
  DefinitionRequest,
  TypeDefinitionRequest,
} from "@volar/language-server/protocol.js";
import { dirname, relative } from "pathe";
import { readPackageJSON, resolvePackageJSON } from "pkg-types";
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
  readonly population: number;
  readonly broadened: boolean;
  readonly isIncomplete: boolean;
  readonly total: number;
  readonly offset: number;
  readonly items: readonly CompletionItem[];
  readonly definitionUris: readonly string[];
  readonly locations?: ReadonlyMap<string, string>;
  readonly packageRoot?: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly subpaths: readonly string[];
  readonly includeDocs: boolean;
  readonly nextOffset?: number;
  readonly resolved?: boolean;
};

const declarationUris = async ({
  workspace,
  moduleName,
  names,
  uri,
  signal,
}: {
  readonly workspace: VolarWorkspace;
  readonly moduleName: string;
  readonly names: readonly string[];
  readonly uri: string;
  readonly signal: AbortSignal;
}): Promise<ReadonlyMap<string, string>> => {
  const head = "import { ";
  const source = `${head}${names.join(", ")} } from ${JSON.stringify(moduleName)};`;
  const targets = names.map((name, index) => ({
    name,
    character:
      head.length +
      names.slice(0, index).reduce((total, previous) => total + previous.length + 2, 0),
  }));
  return await workspace.withTextDocument({
    uri,
    languageId: "typescript",
    source,
    signal,
    task: async (textDocument) => {
      const resolved = await Promise.all(
        targets.map(async ({ name, character }) => {
          const result = await workspace.sendRequest(
            DefinitionRequest.type,
            { textDocument, position: { line: 0, character } },
            signal,
          );
          const found = (Array.isArray(result) ? result : [result]).flatMap((location) => {
            const target = location && ("uri" in location ? location.uri : location.targetUri);
            return target && target !== uri ? [target] : [];
          });
          return [name, found[0] && relative(workspace.root, URI.parse(found[0]).fsPath)] as const;
        }),
      );
      return new Map(
        resolved.flatMap(([name, target]) => (target ? [[name, target] as const] : [])),
      );
    },
  });
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
 * The probe imports the module under the alias `__module`, and TypeScript
 * prints that alias into every resolved signature — `(left: __module.Money)`
 * is scaffolding no consumer ever wrote. The alias leaves the text here,
 * before anything downstream reads it.
 */
const withoutProbeAlias = (item: CompletionItem): CompletionItem => ({
  ...item,
  ...(item.detail === undefined ? {} : { detail: item.detail.replaceAll("__module.", "") }),
  ...(typeof item.documentation === "string"
    ? { documentation: item.documentation.replaceAll("__module.", "") }
    : item.documentation !== undefined && "value" in item.documentation
      ? {
          documentation: {
            ...item.documentation,
            value: item.documentation.value.replaceAll("__module.", ""),
          },
        }
      : {}),
});

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
  // The marker is shared with the server, which uses it to keep these out of a
  // whole-project check: they are this tool's scaffolding, and their unfinished
  // lines were being reported as problems in the caller's own project.
  const probeUri = parsedUri.with({ path: `${parsedUri.path}${probeMarker}probe.ts` }).toString();
  const locationUri = parsedUri
    .with({ path: `${parsedUri.path}${probeMarker}locations.ts` })
    .toString();
  const effectiveSurface = type || path.length ? "runtime" : surface;
  const { source, position, definitionPosition } = probe({
    moduleName,
    type,
    path,
    surface: effectiveSurface,
  });
  const resolvedModule = await workspace.sendRequest(
    ResolveDependencySourceRequest.type,
    {
      textDocument: { uri },
      moduleName,
    },
    signal,
  );
  const manifestPath = resolvedModule?.resolvedFileName
    ? await resolvePackageJSON(resolvedModule.resolvedFileName).catch(() => undefined)
    : undefined;
  const packageJson = manifestPath ? await readPackageJSON(manifestPath) : undefined;
  const exports =
    !type && !path.length && packageJson?.name === moduleName ? packageJson.exports : undefined;
  const subpaths =
    includeSubpaths && exports && typeof exports === "object" && !Array.isArray(exports)
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
      const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
      const named = (item: CompletionItem) => (item.filterText ?? item.label).toLocaleLowerCase();
      const everyTerm = terms.length
        ? exportItems.filter((item) => terms.every((term) => named(item).includes(term)))
        : exportItems;
      const broadened = !everyTerm.length && terms.length > 1;
      const queriedItems = broadened
        ? exportItems.filter((item) => terms.some((term) => named(item).includes(term)))
        : everyTerm;
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
      const importable =
        includeDetails && !type && !path.length
          ? resultPage.items
              .map((item) => item.label)
              .filter((label) => /^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u.test(label))
          : [];
      const unlisted = type && !resultPage.total && !path.length ? [type] : [];
      const looked = [...importable, ...unlisted];
      const locations = looked.length
        ? await declarationUris({ workspace, moduleName, names: looked, uri: locationUri, signal })
        : undefined;
      return {
        module: moduleName,
        type,
        path,
        surface: effectiveSurface,
        query,
        population: exportItems.length,
        broadened,
        includeDocs,
        definitionUris:
          definitions === undefined || definitions === null
            ? []
            : (Array.isArray(definitions) ? definitions : [definitions]).map((definition) =>
                "uri" in definition ? definition.uri : definition.targetUri,
              ),
        locations,
        packageRoot: manifestPath ? dirname(manifestPath) : undefined,
        packageName: packageJson?.name,
        packageVersion: packageJson?.version,
        subpaths,
        isIncomplete: Array.isArray(completion) ? false : (completion?.isIncomplete ?? false),
        ...resultPage,
        items: selectedItems.map(withoutProbeAlias),
        resolved: completion !== null,
      };
    },
  });
};
