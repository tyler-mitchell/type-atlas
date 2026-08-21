import {
  createTypeAtlas,
  containingGitSubmodule,
  documentSymbols,
  findGitSubmoduleRoots,
  inspectSymbol,
  type InspectSymbolResult,
  type InspectSymbolTarget,
  renderDocument,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { markupText, sameRange, displayPath } from "atlascii";
import { inspectionVariables } from "./inspection-variables.ts";
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
  /** The declaration the printed snippet shows, which the label names. */
  readonly shownPath?: readonly SymbolPathItem[];
  readonly shown?: SymbolPathItem;
  readonly exactIdentifier: boolean;
  /** The range is import/export statements only — names, not behavior. */
  readonly plumbing: boolean;
  readonly content?: string;
  readonly contentStartLine: number;
  readonly hover?: Hover | null;
};

export type RetrievalPage = {
  readonly page: SembleSearchPage;
  readonly root: string;
  readonly searchRoot: string;
  readonly anchors: readonly string[];
  readonly matches: readonly RetrievalMatch[];
};

const queryAnchors = (query: string): ReadonlySet<string> =>
  new Set(
    (query.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).filter((identifier) =>
      /[$_\p{Lu}]/u.test(identifier),
    ),
  );

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

/**
 * Whether a range is only import/export statements — names, not behavior.
 *
 * A barrel names every concept a package exports, so it outranks the code
 * implementing them for almost any behavioral query, and a reader acting on
 * it learns nothing. The observation is stated on the match rather than used
 * to reorder: relevance is score-relative, and an order that contradicts the
 * printed percentages would be a second defect.
 */
const moduleStatementsOnly = (text: string) => {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter((line) => line.trim() && !/^\s*\/\//u.test(line))
    .join("\n");
  return stripped.length > 0 && /^\s*(?:(?:import|export)\b[^;]*;\s*)+$/u.test(stripped);
};

export const enrichRetrievalPage = async (input: {
  readonly page: SembleSearchPage;
  readonly root: string;
  readonly searchRoot: string;
  readonly includeTypes: boolean;
  readonly snippetLines: number | null;
  readonly anchorIdentifiers?: readonly string[];
  /**
   * The text anchors are read from, when the query line is a caption rather
   * than a question. A similarity seed's "Related to <path>" is not typed by
   * a caller, and anchoring on it declared the literal word "Related" a name
   * nobody asked for — pass "" and the answer says it ranked by meaning.
   */
  readonly anchorText?: string;
  readonly workspaces: VolarWorkspacePool;
  readonly signal: AbortSignal;
}): Promise<RetrievalPage> => {
  const workspace = await input.workspaces.get(input.root);
  const intelligence = createTypeAtlas(workspace);
  const anchorIdentifiers = new Set(input.anchorIdentifiers ?? []);
  const queryIdentifiers = new Set([
    ...queryAnchors(input.anchorText ?? input.page.query),
    ...(input.anchorIdentifiers ?? []),
  ]);
  return {
    page: input.page,
    root: input.root,
    searchRoot: input.searchRoot,
    anchors: [...queryIdentifiers],
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
        // The declaration that best covers a line window: most overlap first,
        // deepest on a tie, and a name the query used wins outright.
        const bestPath = (from: number, to: number) => {
          const ranked = [...overlappingSymbolPaths(symbols ?? [], from, to)].sort(
            (left, right) =>
              overlapLength(right.at(-1)!.range, from, to) -
                overlapLength(left.at(-1)!.range, from, to) || right.length - left.length,
          );
          return ranked.find((path) => queryIdentifiers.has(path.at(-1)!.symbol.name)) ?? ranked[0];
        };
        const symbolPath = bestPath(resultStartLine, resultEndLine);
        const selected = symbolPath?.at(-1);
        const exactIdentifier = !!selected && queryIdentifiers.has(selected.symbol.name);
        // The snippet is cut from the file, not from the matched chunk the
        // search returned: that chunk arrives with its first line stripped of
        // indentation, so a character read off it addressed the wrong column.
        const sourceLines = source.split("\n");
        const anchorLine = sourceLines.findIndex(
          (line) =>
            !/^\s*(?:\/\/|\/\*|\*)/u.test(line) &&
            (line.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).some((identifier) =>
              anchorIdentifiers.has(identifier),
            ),
        );
        const focusLine =
          anchorLine < 0 && exactIdentifier ? selected.selection.start.line : anchorLine;
        const snippetStart =
          focusLine < 0 || input.snippetLines === null
            ? resultStartLine
            : Math.min(
                Math.max(0, sourceLines.length - input.snippetLines),
                Math.max(0, focusLine - Math.floor(input.snippetLines / 2)),
              );
        const snippetEnd =
          input.snippetLines === null ? resultEndLine + 1 : snippetStart + input.snippetLines;
        // Anchor the label to the lines actually printed, not to the chunk
        // retrieval matched. The snippet re-centres on the query's own
        // identifier, so the two windows differ, and a declaration that merely
        // overlapped the chunk was being named above a snippet that never
        // showed it — `AccountStore` titling six lines of `parentPath`. The
        // name a reader sees now belongs to the code beside it.
        const shownPath = bestPath(snippetStart, snippetEnd - 1) ?? symbolPath;
        const shown = shownPath?.at(-1);
        const hover =
          shown && input.includeTypes
            ? (
                await intelligence.hover({
                  file,
                  signal: input.signal,
                  params: { position: shown.selection.start },
                })
              ).result
            : undefined;
        return {
          result,
          file,
          displayFile: displayPath(URI.file(file).toString(), input.root),
          // Two anchors, because two jobs. `path`/`selected` is the
          // declaration retrieval matched, and relationship expansion keys off
          // it — narrowing it to the printed window stopped
          // `investigate_code` landing on questions it used to answer.
          // `shownPath`/`shown` is what the snippet actually displays, and
          // only the label uses it.
          path: symbolPath,
          selected,
          shownPath,
          shown,
          exactIdentifier,
          // A range in a file whose outline is empty is a barrel or manifest
          // — the range test alone misses a slice from the middle of one
          // long re-export statement, which starts no statement and closes
          // none.
          plumbing:
            symbolPath === undefined &&
            ((symbols ?? []).length === 0 ||
              moduleStatementsOnly(
                sourceLines.slice(resultStartLine, resultEndLine + 1).join("\n"),
              )),
          content:
            input.snippetLines === 0
              ? undefined
              : sourceLines.slice(snippetStart, snippetEnd).join("\n"),
          contentStartLine: snippetStart,
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

// Words that carry no identifier signal in a question.
const QUESTION_NOISE = new Set([
  "and",
  "any",
  "are",
  "been",
  "code",
  "codebase",
  "configured",
  "defined",
  "does",
  "file",
  "for",
  "from",
  "handled",
  "have",
  "how",
  "implemented",
  "into",
  "the",
  "that",
  "this",
  "used",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
]);

// Identifier-shaped tokens of a text: whole word plus camel/snake parts,
// lowercased — same splits semble indexes by, so question and symbol meet on
// the same vocabulary.
const identifierTokens = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .split(/[^A-Za-z0-9_$]+/u)
      .flatMap((word) => [word, ...word.split(/(?=[A-Z])|_/u)])
      .map((part) => part.toLowerCase())
      .filter((part) => part.length >= 3 && !QUESTION_NOISE.has(part)),
  );

/**
 * A retrieval page as the facts a reader needs, with nothing decided about how
 * it reads. Ranking happens here because it is selection, not presentation:
 * which hits survive the exclusion and the limit, and in what order.
 */
/** A hit's score as a percentage of the strongest one. */
export const relevanceOf = (score: number, topScore: number | undefined): number =>
  topScore && topScore > 0 ? Math.round((score / topScore) * 100) : 0;

const searchPage = (input: {
  readonly retrieval: RetrievalPage;
  readonly exclude?: {
    readonly file: string;
    readonly position: Range["start"];
  };
  readonly explainRelevance?: boolean;
  readonly limit?: number;
}) => {
  const exclude = input.exclude;
  const ranked = input.retrieval.matches
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
    .sort((left, right) => Number(right.exactIdentifier) - Number(left.exactIdentifier))
    .slice(0, input.limit);
  const topScore = ranked.length ? Math.max(...ranked.map((match) => match.result.score)) : 0;
  const anchoredCount = ranked.filter((match) => match.exactIdentifier).length;
  const anchors = input.retrieval.anchors;
  return {
    query: input.retrieval.page.query,
    count: ranked.length,
    explainRelevance: ranked.length > 0 && input.explainRelevance !== false,
    // Deliberately NOT exposed: the absolute score behind the percentages.
    // Witnessed 2026-08-20 — a question the index answers well scored 0.03
    // and one it cannot answer 0.02, while code-to-code similarity reached
    // 0.57: the scale is modality-dependent and nearly flat for natural
    // language, so printing it would smear good answers as garbage and no
    // confidence floor can stand on it. The weak-anchor defect needs a
    // different signal (docs/issues.md, Codex field report).
    anchoredCount,
    anchors,
    unanchored: anchoredCount === 0 && anchors.length > 0,
    unanchorable: anchoredCount === 0 && anchors.length === 0,
    matches: ranked.map((match, index) => {
      const lines = match.content?.split("\n");
      // The label follows the printed snippet, not the matched chunk: the two
      // windows differ, and naming a declaration the reader cannot see sends
      // the next call to the wrong position.
      const labelledPath = match.shownPath ?? match.path;
      const labelled = match.shown ?? match.selected;
      return {
        rank: index + 1,
        file: match.displayFile,
        startLine: lines?.length ? match.contentStartLine + 1 : match.result.start_line,
        endLine: match.result.end_line,
        relevance: relevanceOf(match.result.score, topScore),
        within: labelledPath?.map(({ symbol }) => symbol.name),
        name: labelled?.symbol.name,
        kind: labelled?.symbol.kind,
        selection: labelled?.selection,
        // Named only when it differs from the selection: repeating an
        // identifier's own span costs a second read to learn nothing.
        extent:
          labelled && !sameRange(labelled.range, labelled.selection) ? labelled.range : undefined,
        anchored: match.exactIdentifier,
        plumbing: match.plumbing,
        documentation: match.hover
          ? markupText(match.hover.contents) || "No hover content."
          : undefined,
        lines,
      };
    }),
  };
};

const renderInspection = async (result: InspectSymbolResult, root: string): Promise<string> =>
  (
    await renderDocument({
      document: "inspect-symbol.tool.mdoc",
      variables: inspectionVariables({ result, root }),
    })
  ).text;

const renderSearchPage = async (input: Parameters<typeof searchPage>[0]): Promise<string> =>
  (
    await renderDocument({
      document: "search.tool.mdoc",
      variables: searchPage(input),
    })
  ).text;

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
    const anchors = queryAnchors(request.query);
    const wide = await scopedSearch({
      semble: dependencies.semble,
      root: request.root,
      searchRoot,
      query: request.query,
      limit: anchors.size ? Math.min(request.limit * 4, 40) : request.limit,
      signal: request.signal,
    });
    const mentions = (content: string | null | undefined) =>
      !!content &&
      (content.match(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu) ?? []).some((identifier) =>
        anchors.has(identifier),
      );
    const results = anchors.size
      ? [...wide.results]
          .sort((left, right) => Number(mentions(right.content)) - Number(mentions(left.content)))
          .slice(0, request.limit)
      : wide.results;
    return await enrichRetrievalPage({
      page: { ...wide, results },
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
        query: `Related to ${displayPath(
          URI.file(file).toString(),
          request.root,
        )}:${request.line + 1}`,
      },
      root: request.root,
      searchRoot,
      includeTypes: request.includeTypes,
      snippetLines: request.snippetLines,
      // The query line is a caption; nobody typed it, so nothing anchors.
      anchorText: "",
      workspaces: dependencies.workspaces,
      signal: request.signal,
    });
  };

  return {
    search: async (request: Parameters<typeof search>[0]) =>
      renderSearchPage({ retrieval: await search(request) }),
    findRelated: async (request: Parameters<typeof findRelated>[0]) =>
      renderSearchPage({ retrieval: await findRelated(request) }),
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
      const inspectionText = await renderInspection(inspection, request.root);
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
            renderSearchPage({
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
      const searchText = await renderSearchPage({
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
      // Floor before expansion: the question must name something the
      // candidate declares. Without it, a question the index cannot answer
      // still expanded its nearest neighbour at relevance 100% and dressed a
      // wrong symbol in "Verified relationships" (the ledger's standing
      // reproducer). Retrieval scores cannot carry this floor — near-flat
      // for natural language — so the anchor is lexical: shared identifier
      // tokens, same splits semble itself indexes by.
      const questionTokens = identifierTokens(request.question);
      const namesQuestion = (candidate: (typeof coherent)[number]): boolean =>
        [
          ...identifierTokens(
            [
              candidate.selected.symbol.name,
              ...(candidate.path?.map(({ symbol }) => symbol.name) ?? []),
            ].join(" "),
          ),
        ].some((token) => questionTokens.has(token));
      const expandable = exact ? coherent : coherent.filter(namesQuestion);
      const deepest = Math.max(...expandable.map(({ path }) => path?.length ?? 1));
      const candidates = expandable
        .filter(({ path }) => (path?.length ?? 1) === deepest)
        .slice(0, request.inspectionLimit);
      if (!candidates.length) {
        return coherent.length === 0
          ? searchText
          : `${searchText}\n\nNone of these declares anything the question names, so no relationship expansion follows — the matches above are retrieval's nearest neighbours, not an answer. If the concept should exist here, ask again naming an identifier from it; if you are proving absence, occurrences gives the literal zero.`;
      }
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
      const inspectionTexts = await Promise.all(
        inspections.map((inspection) => renderInspection(inspection, request.root)),
      );
      const relatedText = related
        ? await renderSearchPage({
            retrieval: related,
            exclude: {
              file: candidates[0]!.file,
              position: candidates[0]!.selected.selection.start,
            },
            explainRelevance: false,
            limit: request.relatedLimit,
          })
        : undefined;
      const rendered = await renderDocument({
        document: "investigate.tool.mdoc",
        variables: {
          search: searchText,
          exact,
          ranks: candidateRanks.map(String),
          candidateCount: inspections.length,
          inspections: inspectionTexts.map((text, index) => ({
            title:
              inspections.length > 1 ? `Retrieved candidate ${candidateRanks[index]}` : undefined,
            text,
          })),
          related: relatedText,
        },
      });
      return rendered.text;
    },
  };
};
