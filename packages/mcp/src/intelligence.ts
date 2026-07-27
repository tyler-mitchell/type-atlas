import {
  createTypeAtlas,
  inspectSymbol,
  type InspectSymbolTarget,
  type VolarWorkspacePool,
} from "@typeatlas/core";
import { hoverContentsText, symbolKind, workspacePath } from "@typeatlas/core/text";
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
  readonly exactIdentifier: boolean;
  readonly content?: string;
  readonly contentStartLine: number;
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
    const path = [...ancestors, { symbol, range, selection: symbolSelection(symbol) }];
    return [
      path,
      ...overlappingSymbolPaths(
        "children" in symbol ? (symbol.children ?? []) : [],
        startLine,
        endLine,
        path,
      ),
    ];
  });

const overlapLength = (range: Range, startLine: number, endLine: number): number =>
  Math.max(0, Math.min(range.end.line, endLine) - Math.max(range.start.line, startLine) + 1);

const resolveSearchRoot = (root: string, scope: string | undefined): string => {
  const workspaceRoot = path.resolve(root);
  const searchRoot = path.resolve(workspaceRoot, scope ?? ".");
  if (searchRoot !== workspaceRoot && !isFileInDir(searchRoot, workspaceRoot)) {
    throw new Error(`Search scope is outside the workspace: ${scope}`);
  }
  return searchRoot;
};

const sourceRange = (range: Range): string =>
  `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;

const enrichPage = async (input: {
  readonly page: SembleSearchPage;
  readonly root: string;
  readonly searchRoot: string;
  readonly includeTypes: boolean;
  readonly snippetLines: number | null;
  readonly workspaces: VolarWorkspacePool;
  readonly signal: AbortSignal;
}): Promise<RetrievalPage> => {
  const workspace = await input.workspaces.get(input.root);
  const intelligence = createTypeAtlas(workspace);
  const queryIdentifiers = new Set(
    (input.page.query.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).filter((identifier) =>
      /[$_\p{Lu}]/u.test(identifier),
    ),
  );
  return {
    page: input.page,
    root: input.root,
    searchRoot: input.searchRoot,
    matches: await Promise.all(
      input.page.results.map(async (result) => {
        const file = path.resolve(input.searchRoot, result.file_path);
        const { symbols } = await intelligence.documentSymbols(file, input.signal);
        const startLine = result.start_line - 1;
        const endLine = result.end_line - 1;
        const symbolPaths = [...overlappingSymbolPaths(symbols ?? [], startLine, endLine)].sort(
          (left, right) =>
            overlapLength(right.at(-1)!.range, startLine, endLine) -
              overlapLength(left.at(-1)!.range, startLine, endLine) || right.length - left.length,
        );
        const symbolPath =
          symbolPaths.find((path) => queryIdentifiers.has(path.at(-1)!.symbol.name)) ??
          symbolPaths[0];
        const selected = symbolPath?.at(-1);
        const contentLines = result.content?.split("\n") ?? [];
        const snippetStart =
          input.snippetLines === null
            ? 0
            : Math.min(
                Math.max(0, contentLines.length - input.snippetLines),
                Math.max(
                  0,
                  (selected?.selection.start.line ?? startLine) -
                    startLine -
                    Math.floor(input.snippetLines / 2),
                ),
              );
        const hover =
          selected && input.includeTypes
            ? (await intelligence.hover(file, selected.selection.start, input.signal)).hover
            : undefined;
        return {
          result,
          file,
          displayFile: workspacePath(URI.file(file).toString(), input.root),
          path: symbolPath,
          selected,
          exactIdentifier: !!selected && queryIdentifiers.has(selected.symbol.name),
          content:
            input.snippetLines === 0
              ? undefined
              : contentLines
                  .slice(
                    snippetStart,
                    input.snippetLines === null ? undefined : snippetStart + input.snippetLines,
                  )
                  .join("\n"),
          contentStartLine: startLine + snippetStart,
          hover,
        };
      }),
    ),
  };
};

const sameAnchor = (
  left: { readonly file: string; readonly position: Range["start"] },
  right: { readonly file: string; readonly position: Range["start"] },
): boolean =>
  left.file === right.file &&
  left.position.line === right.position.line &&
  left.position.character === right.position.character;

const formatMatch = (match: RetrievalMatch): string =>
  [
    `${match.displayFile}:${match.result.start_line - 1}-${match.result.end_line - 1}`,
    ...(match.path?.length
      ? [`Structure: ${match.path.map(({ symbol }) => symbol.name).join(" › ")}`]
      : []),
    ...(match.selected
      ? [
          `Symbol: ${match.selected.symbol.name} [${symbolKind(
            match.selected.symbol.kind,
          )}] · selection ${sourceRange(match.selected.selection)}${
            sourceRange(match.selected.range) === sourceRange(match.selected.selection)
              ? ""
              : ` · body ${sourceRange(match.selected.range)}`
          }`,
        ]
      : []),
    ...(match.hover ? [hoverContentsText(match.hover.contents) ?? "No hover content."] : []),
    ...(match.content
      ? match.content.split("\n").map((line, index) => `${match.contentStartLine + index}|${line}`)
      : []),
  ].join("\n");

const formatPage = (input: {
  readonly retrieval: RetrievalPage;
  readonly exclude?: {
    readonly file: string;
    readonly position: Range["start"];
  };
  readonly explainRelevance?: boolean;
  readonly limit?: number;
}): string => {
  const exclude = input.exclude;
  const matches = input.retrieval.matches
    .filter(
      (match) =>
        !(
          exclude &&
          match.path?.some(({ selection }) =>
            sameAnchor(exclude, {
              file: match.file,
              position: selection.start,
            }),
          )
        ),
    )
    .slice(0, input.limit);
  const topScore = matches[0]?.result.score;
  return [
    `Search: ${input.retrieval.page.query}`,
    `${matches.length} ${matches.length === 1 ? "match" : "matches"}${
      matches.length && input.explainRelevance !== false
        ? " · relevance is relative to the top result shown"
        : ""
    }`,
    "",
    ...matches.flatMap((match, index) => [
      `## ${index + 1} · relevance ${
        topScore && topScore > 0 ? Math.round((match.result.score / topScore) * 100) : 0
      }%`,
      formatMatch(match),
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
};

export const createRetrievalIntelligence = (dependencies: {
  readonly semble: Semble;
  readonly workspaces: VolarWorkspacePool;
}) => {
  const search = async (request: {
    readonly root: string;
    readonly scope?: string;
    readonly query: string;
    readonly includeTypes: boolean;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> => {
    const searchRoot = resolveSearchRoot(request.root, request.scope);
    return await enrichPage({
      page: await dependencies.semble.search({
        repo: searchRoot,
        query: request.query,
        limit: request.limit,
        snippetLines: null,
        signal: request.signal,
      }),
      root: request.root,
      searchRoot,
      includeTypes: request.includeTypes,
      snippetLines: request.snippetLines,
      workspaces: dependencies.workspaces,
      signal: request.signal,
    });
  };

  const findRelated = async (request: {
    readonly root: string;
    readonly scope?: string;
    readonly file: string;
    readonly line: number;
    readonly includeTypes: boolean;
    readonly limit: number;
    readonly fetchLimit?: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> => {
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
      snippetLines: null,
      signal: request.signal,
    });
    return await enrichPage({
      page: {
        ...page,
        query: `Related to ${workspacePath(
          URI.file(file).toString(),
          request.root,
        )}:${request.line}`,
      },
      root: request.root,
      searchRoot,
      includeTypes: request.includeTypes,
      snippetLines: request.snippetLines,
      workspaces: dependencies.workspaces,
      signal: request.signal,
    });
  };

  return {
    search: async (request: Parameters<typeof search>[0]) =>
      formatPage({ retrieval: await search(request) }),
    findRelated: async (request: Parameters<typeof findRelated>[0]) =>
      formatPage({ retrieval: await findRelated(request) }),
    exploreSymbol: async (request: {
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
    }) => {
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
    investigate: async (request: {
      readonly root: string;
      readonly scope?: string;
      readonly question: string;
      readonly candidateLimit: number;
      readonly inspectionLimit: number;
      readonly relatedLimit: number;
      readonly relationshipLimit: number;
      readonly snippetLines: number | null;
      readonly includeSource: boolean;
      readonly signal: AbortSignal;
    }) => {
      const retrieval = await search({
        root: request.root,
        scope: request.scope,
        query: request.question,
        includeTypes: false,
        limit: Math.min(request.candidateLimit * 3, 20),
        snippetLines: request.snippetLines,
        signal: request.signal,
      });
      const searchText = formatPage({
        retrieval,
        limit: request.candidateLimit,
      });
      const anchored = retrieval.matches
        .filter(
          (match): match is RetrievalMatch & { readonly selected: SymbolPathItem } =>
            !!match.selected,
        )
        .filter(
          (match, index, matches) =>
            matches.findIndex((candidate) =>
              sameAnchor(
                {
                  file: match.file,
                  position: match.selected.selection.start,
                },
                {
                  file: candidate.file,
                  position: candidate.selected.selection.start,
                },
              ),
            ) === index,
        );
      const exact = anchored.find(({ exactIdentifier }) => exactIdentifier);
      const primary = anchored[0];
      const primaryContainer = primary?.path?.[0] ?? primary?.selected;
      const coherent = exact
        ? [exact]
        : primary && primaryContainer
          ? anchored.filter(
              (candidate) =>
                candidate === primary ||
                candidate.path?.some(({ selection }) =>
                  sameAnchor(
                    {
                      file: primary.file,
                      position: primaryContainer.selection.start,
                    },
                    {
                      file: candidate.file,
                      position: selection.start,
                    },
                  ),
                ),
            )
          : [];
      const deepest = Math.max(...coherent.map(({ path }) => path?.length ?? 1));
      const candidates = coherent
        .filter(({ path }) => (path?.length ?? 1) === deepest)
        .slice(0, request.inspectionLimit);
      if (!candidates.length) return searchText;
      const workspace = await dependencies.workspaces.get(request.root);
      const inspections = await Promise.all(
        candidates.map((candidate) =>
          inspectSymbol(
            workspace,
            request.root,
            candidate.file,
            { position: candidate.selected.selection.start },
            {
              includeSource: request.includeSource,
              includeTypeDefinitions: false,
              limit: request.relationshipLimit,
            },
            request.signal,
          ),
        ),
      );
      const related = request.relatedLimit
        ? await findRelated({
            root: request.root,
            scope: request.scope,
            file: candidates[0]!.file,
            line: candidates[0]!.selected.selection.start.line,
            includeTypes: false,
            limit: request.relatedLimit,
            fetchLimit: Math.min(request.relatedLimit * 3, 20),
            snippetLines: request.snippetLines,
            signal: request.signal,
          })
        : undefined;
      const candidateRanks = candidates.map(
        (candidate) => retrieval.matches.indexOf(candidate) + 1,
      );
      return [
        searchText,
        "",
        `Verified relationships for ${
          exact
            ? `the exact identifier match · retrieved candidate ${candidateRanks[0]}`
            : `structurally connected retrieved ${
                inspections.length === 1 ? "candidate" : "candidates"
              } ${candidateRanks.join(", ")}`
        }`,
        ...inspections.flatMap((inspection, index) => [
          ...(inspections.length > 1
            ? ["", `### Retrieved candidate ${candidateRanks[index]}`]
            : []),
          inspection.text,
        ]),
        ...(related
          ? [
              "",
              "Related code · similarity is not a call or reference relationship",
              formatPage({
                retrieval: related,
                exclude: {
                  file: candidates[0]!.file,
                  position: candidates[0]!.selected.selection.start,
                },
                explainRelevance: false,
                limit: request.relatedLimit,
              }),
            ]
          : []),
      ].join("\n");
    },
  };
};
