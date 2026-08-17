import {
  createTypeAtlas,
  containingGitSubmodule,
  documentSymbols,
  findGitSubmoduleRoots,
  formatSymbolInspection,
  inspectSymbol,
  type InspectSymbolTarget,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { hoverContentsText, symbolKind, workspacePath } from "@type-atlas/core/text";
import { isFileInDir } from "@volar/language-server/node.js";
import { stat } from "node:fs/promises";
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

export type RetrievalMatch = {
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

export type RetrievalPage = {
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

const resolveSearchRoot = async (root: string, directory: string | undefined): Promise<string> => {
  const workspaceRoot = path.resolve(root);
  const searchRoot = path.resolve(workspaceRoot, directory ?? ".");
  if (searchRoot !== workspaceRoot && !isFileInDir(searchRoot, workspaceRoot)) {
    throw new Error(`Search directory is outside the workspace: ${directory}`);
  }
  // A file reaches the indexer as a root it cannot walk, which fails deep in
  // indexing as an unreadable directory rather than at the argument that was
  // wrong. Name the directory that file lives in, since that is what the
  // caller meant.
  const searchRootStat = await stat(searchRoot).catch(() => undefined);
  if (searchRootStat && !searchRootStat.isDirectory()) {
    throw new Error(
      `Search directory is a file: ${directory}. Pass the directory containing it: ${path.relative(workspaceRoot, path.dirname(searchRoot)) || "."}`,
    );
  }
  const submoduleRoots = await findGitSubmoduleRoots(workspaceRoot);
  const submoduleRoot =
    containingGitSubmodule(searchRoot, submoduleRoots) ??
    submoduleRoots.find((candidate) => isFileInDir(candidate, searchRoot));
  if (submoduleRoot) {
    throw new Error(
      `Search directory contains nested workspace ${path.relative(workspaceRoot, submoduleRoot)}. Use that path as workspace or choose a narrower parent-workspace directory.`,
    );
  }
  return searchRoot;
};

const sourceRange = (range: Range): string =>
  `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;

export const enrichRetrievalPage = async (input: {
  readonly page: SembleSearchPage;
  readonly root: string;
  readonly searchRoot: string;
  readonly includeTypes: boolean;
  readonly snippetLines: number | null;
  readonly anchorIdentifiers?: readonly string[];
  readonly workspaces: VolarWorkspacePool;
  readonly signal: AbortSignal;
}): Promise<RetrievalPage> => {
  const workspace = await input.workspaces.get(input.root);
  const intelligence = createTypeAtlas(workspace);
  const anchorIdentifiers = new Set(input.anchorIdentifiers ?? []);
  const queryIdentifiers = new Set([
    ...(input.page.query.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).filter(
      (identifier) => /[$_\p{Lu}]/u.test(identifier),
    ),
    ...(input.anchorIdentifiers ?? []),
  ]);
  return {
    page: input.page,
    root: input.root,
    searchRoot: input.searchRoot,
    matches: await Promise.all(
      input.page.results.map(async (result) => {
        const file = path.resolve(input.searchRoot, result.file_path);
        // Semantic search answers from the whole search root, so results land in
        // packages this session has never opened. Labelling one with the symbol
        // containing it is a question about that file's own syntax; asking the
        // language server would resolve each result to its project and build
        // that project's program, so a three-result page could build three.
        const read = await workspace.readTextDocumentUri(
          workspace.getWorkspaceUri(file),
          input.signal,
        );
        const source = read.source;
        const symbols = documentSymbols({ uri: read.textDocument.uri, source });
        const resultStartLine = result.start_line - 1;
        const resultEndLine = result.end_line - 1;
        const symbolPaths = [
          ...overlappingSymbolPaths(symbols ?? [], resultStartLine, resultEndLine),
        ].sort(
          (left, right) =>
            overlapLength(right.at(-1)!.range, resultStartLine, resultEndLine) -
              overlapLength(left.at(-1)!.range, resultStartLine, resultEndLine) ||
            right.length - left.length,
        );
        const symbolPath =
          symbolPaths.find((path) => queryIdentifiers.has(path.at(-1)!.symbol.name)) ??
          symbolPaths[0];
        const selected = symbolPath?.at(-1);
        const contentLines = anchorIdentifiers.size
          ? source.split("\n")
          : (result.content?.split("\n") ?? []);
        const contentStartLine = anchorIdentifiers.size ? 0 : resultStartLine;
        const anchorLine = contentLines.findIndex(
          (line) =>
            !/^\s*(?:\/\/|\/\*|\*)/u.test(line) &&
            (line.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).some((identifier) =>
              anchorIdentifiers.has(identifier),
            ),
        );
        const anchorSourceLine = anchorLine < 0 ? undefined : contentStartLine + anchorLine;
        const snippetStart =
          input.snippetLines === null
            ? 0
            : Math.min(
                Math.max(0, contentLines.length - input.snippetLines),
                Math.max(
                  0,
                  (anchorSourceLine ?? selected?.selection.start.line ?? resultStartLine) -
                    contentStartLine -
                    Math.floor(input.snippetLines / 2),
                ),
              );
        const hover =
          selected && input.includeTypes
            ? (
                await intelligence.hover({
                  file,
                  signal: input.signal,
                  params: { position: selected.selection.start },
                })
              ).result
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
          contentStartLine: contentStartLine + snippetStart,
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

/**
 * Renders the optional similarity section without discarding a completed
 * inspection when retrieval is unavailable.
 *
 * Cancellation still propagates so timeouts and aborts are not reported as a
 * missing similarity provider.
 */
const relatedCodeSection = async (
  render: () => Promise<string>,
  signal: AbortSignal,
): Promise<readonly string[]> => {
  try {
    return ["Related code · similarity is not a call or reference relationship", await render()];
  } catch (error) {
    if (signal.aborted) throw error;
    return [`Related code unavailable · ${error instanceof Error ? error.message : String(error)}`];
  }
};

/**
 * Searches a directory without giving it an index of its own.
 *
 * Semble keys its cache on the resolved path it is handed, so a directory and
 * the workspace containing it never share an index: naming the directory as the
 * repo builds a second one from scratch, which on this repository's traffic
 * example cost thirteen seconds — for a narrowing that was asked for to make the
 * search cheaper. The workspace is the index instead, and the directory selects
 * from its results. Semble offers no path filter, so a scoped page is filled by
 * asking for a wider one; a warm search costs tens of milliseconds, so asking
 * twice is far cheaper than a second index. Should the workspace index genuinely
 * not hold enough under that directory, the directory is indexed after all, and
 * the answer is the same one it would have given before.
 */
const scopedSearch = async (input: {
  readonly semble: Semble;
  readonly root: string;
  readonly searchRoot: string;
  readonly query: string;
  readonly limit: number;
  readonly signal: AbortSignal;
}): Promise<SembleSearchPage> => {
  const ask = (repo: string, limit: number) =>
    input.semble.search({
      repo,
      query: input.query,
      limit,
      snippetLines: null,
      signal: input.signal,
    });
  // Whichever root is already indexed and contains this one, so a package inside
  // a monorepo does not build a second index over files the first one holds.
  const indexRoot = input.semble.repo(input.root);
  if (input.searchRoot === indexRoot) return await ask(indexRoot, input.limit);

  // Results come back relative to the root that was indexed, and every reader
  // below resolves them against the search root, so they are re-based to it and
  // a scoped page reads identically however it was obtained.
  const within = (page: SembleSearchPage) => ({
    ...page,
    results: page.results.flatMap((result) => {
      const file = path.resolve(indexRoot, result.file_path);
      return isFileInDir(file, input.searchRoot)
        ? [{ ...result, file_path: platformRelative(input.searchRoot, file) }]
        : [];
    }),
  });
  const wide = within(await ask(indexRoot, Math.min(input.limit * 12, 300)));
  if (wide.results.length >= input.limit) {
    return { ...wide, results: wide.results.slice(0, input.limit) };
  }
  return await ask(input.searchRoot, input.limit);
};

export const createRetrievalIntelligence = (dependencies: {
  readonly semble: Semble;
  readonly workspaces: VolarWorkspacePool;
}) => {
  const search = async (request: {
    readonly root: string;
    readonly directory?: string;
    readonly query: string;
    readonly includeTypes: boolean;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> => {
    const searchRoot = await resolveSearchRoot(request.root, request.directory);
    return await enrichRetrievalPage({
      page: await scopedSearch({
        semble: dependencies.semble,
        root: request.root,
        searchRoot,
        query: request.query,
        limit: request.limit,
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
    readonly directory?: string;
    readonly file: string;
    readonly line: number;
    readonly includeTypes: boolean;
    readonly limit: number;
    readonly fetchLimit?: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<RetrievalPage> => {
    const searchRoot = await resolveSearchRoot(request.root, request.directory);
    const file = path.resolve(request.root, request.file);
    if (!isFileInDir(file, searchRoot)) {
      throw new Error(`Related-code seed is outside the search directory: ${request.file}`);
    }
    const page = await dependencies.semble.findRelated({
      repo: searchRoot,
      file: platformRelative(searchRoot, file),
      line: request.line + 1,
      limit: request.fetchLimit ?? request.limit,
      snippetLines: null,
      signal: request.signal,
    });
    return await enrichRetrievalPage({
      page: {
        ...page,
        query: `Related to ${workspacePath(
          URI.file(file).toString(),
          request.root,
        )}:${request.line + 1}`,
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
      readonly directory?: string;
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
      const inspection = await inspectSymbol({
        workspace,
        root: request.root,
        file: request.file,
        target: request.target,
        options: {
          includeSource: request.includeSource,
          includeTypeDefinitions: request.includeTypeDefinitions,
          limit: request.limit,
        },
        signal: request.signal,
      });
      const { position } = inspection;
      const inspectionText = formatSymbolInspection({ result: inspection, root: request.root });
      if (!position) return inspectionText;
      const anchor = {
        file: path.resolve(request.root, request.file),
        position,
      };
      return [
        inspectionText,
        "",
        ...(await relatedCodeSection(
          async () =>
            formatPage({
              retrieval: await findRelated({
                root: request.root,
                directory: request.directory,
                file: request.file,
                line: position.line,
                includeTypes: false,
                limit: request.relatedLimit,
                fetchLimit: Math.min(request.relatedLimit * 3, 20),
                snippetLines: request.snippetLines,
                signal: request.signal,
              }),
              exclude: anchor,
              limit: request.relatedLimit,
            }),
          request.signal,
        )),
      ].join("\n");
    },
    investigate: async (request: {
      readonly root: string;
      readonly directory?: string;
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
        directory: request.directory,
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
          inspectSymbol({
            workspace,
            root: request.root,
            file: candidate.file,
            target: { position: candidate.selected.selection.start },
            options: {
              includeSource: request.includeSource,
              includeTypeDefinitions: false,
              limit: request.relationshipLimit,
            },
            signal: request.signal,
          }),
        ),
      );
      const related = request.relatedLimit
        ? await findRelated({
            root: request.root,
            directory: request.directory,
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
          formatSymbolInspection({ result: inspection, root: request.root }),
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
