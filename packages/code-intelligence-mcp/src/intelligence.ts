import {
  createCodeIntelligence,
  inspectSymbol,
  type InspectSymbolTarget,
  type VolarWorkspacePool,
} from "@featuretype/code-intelligence";
import {
  hoverContentsText,
  symbolKind,
  workspacePath,
} from "@featuretype/code-intelligence/text";
import { isFileInDir } from "@volar/language-server/node.js";
import { relative as platformRelative } from "node:path";
import * as path from "pathe";
import type {
  DocumentSymbol,
  Hover,
  Range,
  SymbolInformation,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import type { Semble, SembleSearchPage } from "./semble.ts";

type SourceSymbol = DocumentSymbol | SymbolInformation;

type SymbolPathItem = {
  readonly symbol: SourceSymbol;
  readonly range: Range;
  readonly selection: Range;
};

type RetrievalMatch = {
  readonly result: SembleSearchPage["results"][number];
  readonly file: string;
  readonly displayFile: string;
  readonly path?: readonly SymbolPathItem[];
  readonly selected?: SymbolPathItem;
  readonly hover?: Hover | null;
};

type RetrievalPage = {
  readonly page: SembleSearchPage;
  readonly root: string;
  readonly searchRoot: string;
  readonly matches: readonly RetrievalMatch[];
};

const symbolRange = (symbol: SourceSymbol): Range =>
  "location" in symbol ? symbol.location.range : symbol.range;

const symbolSelection = (symbol: SourceSymbol): Range =>
  "location" in symbol ? symbol.location.range : symbol.selectionRange;

const overlappingSymbolPaths = (
  symbols: readonly SourceSymbol[],
  startLine: number,
  endLine: number,
  ancestors: readonly SymbolPathItem[] = [],
): readonly (readonly SymbolPathItem[])[] =>
  symbols.flatMap((symbol) => {
    const range = symbolRange(symbol);
    if (range.end.line < startLine || range.start.line > endLine) return [];
    const path = [
      ...ancestors,
      { symbol, range, selection: symbolSelection(symbol) },
    ];
    return [
      path,
      ...overlappingSymbolPaths(
        "children" in symbol ? symbol.children ?? [] : [],
        startLine,
        endLine,
        path,
      ),
    ];
  });

const overlapLength = (
  range: Range,
  startLine: number,
  endLine: number,
): number =>
  Math.max(
    0,
    Math.min(range.end.line, endLine) -
      Math.max(range.start.line, startLine) + 1,
  );

const resolveSearchRoot = (
  root: string,
  scope: string | undefined,
): string => {
  const workspaceRoot = path.resolve(root);
  const searchRoot = path.resolve(workspaceRoot, scope ?? ".");
  if (searchRoot !== workspaceRoot && !isFileInDir(searchRoot, workspaceRoot)) {
    throw new Error(`Search scope is outside the workspace: ${scope}`);
  }
  return searchRoot;
};

const sourceRange = (range: Range): string =>
  `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;

const enrichPage = async (
  input: {
    readonly page: SembleSearchPage;
    readonly root: string;
    readonly searchRoot: string;
    readonly includeTypes: boolean;
    readonly workspaces: VolarWorkspacePool;
    readonly signal: AbortSignal;
  },
): Promise<RetrievalPage> => {
  const workspace = await input.workspaces.get(input.root);
  const intelligence = createCodeIntelligence(workspace);
  return {
    page: input.page,
    root: input.root,
    searchRoot: input.searchRoot,
    matches: await Promise.all(input.page.results.map(async (result) => {
      const file = path.resolve(input.searchRoot, result.file_path);
      const { symbols } = await intelligence.documentSymbols(file, input.signal);
      const startLine = result.start_line - 1;
      const endLine = result.end_line - 1;
      const symbolPath = [...overlappingSymbolPaths(
        symbols ?? [],
        startLine,
        endLine,
      )].sort((left, right) =>
        overlapLength(right.at(-1)!.range, startLine, endLine) -
          overlapLength(left.at(-1)!.range, startLine, endLine) ||
        right.length - left.length
      )[0];
      const selected = symbolPath?.at(-1);
      const hover = selected && input.includeTypes
        ? (await intelligence.hover(
          file,
          selected.selection.start,
          input.signal,
        )).hover
        : undefined;
      return {
        result,
        file,
        displayFile: workspacePath(URI.file(file).toString(), input.root),
        path: symbolPath,
        selected,
        hover,
      };
    })),
  };
};

const sameAnchor = (
  left: { readonly file: string; readonly position: Range["start"] },
  right: { readonly file: string; readonly position: Range["start"] },
): boolean =>
  left.file === right.file &&
  left.position.line === right.position.line &&
  left.position.character === right.position.character;

const formatMatch = (match: RetrievalMatch): string => [
  `${match.displayFile}:${match.result.start_line - 1}-${match.result.end_line - 1}`,
  ...(match.path?.length
    ? [`Structure: ${
      match.path.map(({ symbol }) => symbol.name).join(" › ")
    }`]
    : []),
  ...(match.selected
    ? [`Symbol: ${match.selected.symbol.name} [${
      symbolKind(match.selected.symbol.kind)
    }] · selection ${sourceRange(match.selected.selection)}${
      sourceRange(match.selected.range) === sourceRange(match.selected.selection)
        ? ""
        : ` · body ${sourceRange(match.selected.range)}`
    }`]
    : []),
  ...(match.hover
    ? [hoverContentsText(match.hover.contents) ?? "No hover content."]
    : []),
  ...(match.result.content
    ? match.result.content.split("\n").map((line, index) =>
      `${match.result.start_line - 1 + index}|${line}`
    )
    : []),
].join("\n");

const formatPage = (
  input: {
    readonly retrieval: RetrievalPage;
    readonly exclude?: {
      readonly file: string;
      readonly position: Range["start"];
    };
    readonly limit?: number;
  },
): string => {
  const exclude = input.exclude;
  const matches = input.retrieval.matches.filter((match) =>
    !(
      exclude && match.path?.some(({ selection }) =>
        sameAnchor(exclude, {
          file: match.file,
          position: selection.start,
        })
      )
    )
  ).slice(0, input.limit);
  return [
    `Search: ${input.retrieval.page.query}`,
    `${matches.length} ${matches.length === 1 ? "match" : "matches"}`,
    "",
    ...matches.flatMap((match, index) => [
      `## ${index + 1}`,
      formatMatch(match),
      "",
    ]),
  ].join("\n").trimEnd();
};

export const createRetrievalIntelligence = (
  dependencies: {
    readonly semble: Semble;
    readonly workspaces: VolarWorkspacePool;
  },
) => {
  const search = async (
    request: {
      readonly root: string;
      readonly scope?: string;
      readonly query: string;
      readonly includeTypes: boolean;
      readonly limit: number;
      readonly snippetLines: number | null;
      readonly signal: AbortSignal;
    },
  ): Promise<RetrievalPage> => {
    const searchRoot = resolveSearchRoot(request.root, request.scope);
    return await enrichPage({
      page: await dependencies.semble.search({
        repo: searchRoot,
        query: request.query,
        limit: request.limit,
        snippetLines: request.snippetLines,
        signal: request.signal,
      }),
      root: request.root,
      searchRoot,
      includeTypes: request.includeTypes,
      workspaces: dependencies.workspaces,
      signal: request.signal,
    });
  };

  const findRelated = async (
    request: {
      readonly root: string;
      readonly scope?: string;
      readonly file: string;
      readonly line: number;
      readonly includeTypes: boolean;
      readonly limit: number;
      readonly fetchLimit?: number;
      readonly snippetLines: number | null;
      readonly signal: AbortSignal;
    },
  ): Promise<RetrievalPage> => {
    const searchRoot = resolveSearchRoot(request.root, request.scope);
    const file = path.resolve(request.root, request.file);
    if (!isFileInDir(file, searchRoot)) {
      throw new Error(`Related-code seed is outside the search scope: ${request.file}`);
    }
    const page = await dependencies.semble.findRelated({
      repo: searchRoot,
      file: platformRelative(searchRoot, file),
      line: request.line + 1,
      limit: request.fetchLimit ?? request.limit,
      snippetLines: request.snippetLines,
      signal: request.signal,
    });
    return await enrichPage({
      page: {
        ...page,
        query: `Related to ${
          workspacePath(URI.file(file).toString(), request.root)
        }:${request.line}`,
      },
      root: request.root,
      searchRoot,
      includeTypes: request.includeTypes,
      workspaces: dependencies.workspaces,
      signal: request.signal,
    });
  };

  return {
    search: async (request: Parameters<typeof search>[0]) =>
      formatPage({ retrieval: await search(request) }),
    findRelated: async (request: Parameters<typeof findRelated>[0]) =>
      formatPage({ retrieval: await findRelated(request) }),
    exploreSymbol: async (
      request: {
        readonly root: string;
        readonly scope?: string;
        readonly file: string;
        readonly target: InspectSymbolTarget;
        readonly includeSource: boolean;
        readonly includeTypeDefinitions: boolean;
        readonly limit: number;
        readonly relatedLimit: number;
        readonly snippetLines: number | null;
        readonly signal: AbortSignal;
      },
    ) => {
      const workspace = await dependencies.workspaces.get(request.root);
      const inspection = await inspectSymbol(
        workspace,
        request.root,
        request.file,
        request.target,
        {
          includeSource: request.includeSource,
          includeTypeDefinitions: request.includeTypeDefinitions,
          limit: request.limit,
        },
        request.signal,
      );
      if (!inspection.position) return inspection.text;
      const anchor = {
        file: path.resolve(request.root, request.file),
        position: inspection.position,
      };
      return [
        inspection.text,
        "",
        "Related code · similarity is not a call or reference relationship",
        formatPage({
          retrieval: await findRelated({
            root: request.root,
            scope: request.scope,
            file: request.file,
            line: inspection.position.line,
            includeTypes: false,
            limit: request.relatedLimit,
            fetchLimit: Math.min(request.relatedLimit * 3, 20),
            snippetLines: request.snippetLines,
            signal: request.signal,
          }),
          exclude: anchor,
          limit: request.relatedLimit,
        }),
      ].join("\n");
    },
    investigate: async (
      request: {
        readonly root: string;
        readonly scope?: string;
        readonly question: string;
        readonly candidateLimit: number;
        readonly relatedLimit: number;
        readonly relationshipLimit: number;
        readonly snippetLines: number | null;
        readonly includeSource: boolean;
        readonly signal: AbortSignal;
      },
    ) => {
      const retrieval = await search({
        root: request.root,
        scope: request.scope,
        query: request.question,
        includeTypes: false,
        limit: request.candidateLimit,
        snippetLines: request.snippetLines,
        signal: request.signal,
      });
      const searchText = formatPage({ retrieval });
      const primary = retrieval.matches.find(({ selected }) => selected);
      if (!primary?.selected) return searchText;
      const inspected = primary.path?.[0] ?? primary.selected;
      const anchor = {
        file: primary.file,
        position: inspected.selection.start,
      };
      const workspace = await dependencies.workspaces.get(request.root);
      const [inspection, related] = await Promise.all([
        inspectSymbol(
          workspace,
          request.root,
          primary.file,
          { position: anchor.position },
          {
            includeSource: request.includeSource,
            includeTypeDefinitions: false,
            limit: request.relationshipLimit,
          },
          request.signal,
        ),
        findRelated({
          root: request.root,
          scope: request.scope,
          file: primary.file,
          line: primary.result.start_line - 1,
          includeTypes: false,
          limit: request.relatedLimit,
          fetchLimit: Math.min(request.relatedLimit * 3, 20),
          snippetLines: request.snippetLines,
          signal: request.signal,
        }),
      ]);
      return [
        searchText,
        "",
        "Verified relationships for the primary match",
        inspection.text,
        "",
        "Related code · similarity is not a call or reference relationship",
        formatPage({
          retrieval: related,
          exclude: anchor,
          limit: request.relatedLimit,
        }),
      ].join("\n");
    },
  };
};
