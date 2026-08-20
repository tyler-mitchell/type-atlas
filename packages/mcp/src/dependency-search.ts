import {
  listModuleExports,
  type ModuleExportPage,
  renderDocument,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { markupText, displayPath } from "atlascii";
import * as path from "pathe";
import { URI } from "vscode-uri";
import { enrichRetrievalPage, type RetrievalMatch } from "./intelligence.ts";
import type { Semble, SembleSearchPage } from "./semble.ts";

/**
 * Whether a snippet is a CommonJS module preamble rather than source.
 *
 * A built package's entry file opens with the interop banner and one very long
 * `exports.a = exports.b = … = void 0` chain. That line names every export the
 * module has, so any query about a name in the package matches it above the
 * code implementing that name, and it tells a reader nothing about behaviour.
 */
const modulePreamble = (content: string | undefined) => {
  const lines = (content ?? "").split("\n").filter((line) => line.trim());
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        /^\s*(?:"use strict";?|Object\.defineProperty\(exports,|exports\.[\w$]+\s*=|module\.exports\s*=|(?:const|let|var)\s+[\w$]+\s*=\s*require\()/.test(
          line,
        ) || /^\s*(?:\/\*|\*|\/\/)/.test(line),
    )
  );
};

type DependencySearchResult =
  | {
      readonly requested: string;
      readonly name: string;
      readonly version?: string;
      readonly packageRoot: string;
      readonly searchRoot: string;
      readonly page: SembleSearchPage;
      readonly matches: readonly RetrievalMatch[];
      readonly elsewhere: number;
      readonly elsewhereFiles: readonly string[];
      readonly api: readonly {
        readonly item: ModuleExportPage["items"][number];
        readonly evidence: SembleSearchPage["results"][number];
      }[];
    }
  | {
      readonly requested: string;
      readonly error: string;
    };

const queryMatchCount = (input: { readonly label: string; readonly terms: ReadonlySet<string> }) =>
  input.label
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(" ")
    .filter((term) => input.terms.has(term)).length;

export const createDependencySearch =
  (dependencies: { readonly semble: Semble; readonly workspaces: VolarWorkspacePool }) =>
  async (request: {
    readonly workspace: string;
    readonly file: string;
    readonly packages: readonly string[];
    readonly query: string;
    readonly path: readonly string[];
    readonly surface: "runtime" | "all";
    readonly type?: string;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<string> => {
    const workspace = await dependencies.workspaces.get(request.workspace);
    const results = await Promise.all(
      request.packages.map(async (name): Promise<DependencySearchResult> => {
        try {
          const queryTerms = new Set(
            (request.query.toLowerCase().match(/[a-z0-9]+/gu) ?? []).flatMap((term) =>
              term.endsWith("s") ? [term, term.slice(0, -1)] : [term],
            ),
          );
          const queryRequestsErrors = ["error", "failure"].some((term) => queryTerms.has(term));
          const exportRequest = {
            workspace,
            module: name,
            fromFile: request.file,
            type: request.type,
            path: request.path,
            surface: request.surface,
            query: "",
            offset: 0,
            limit: 500,
            includeDetails: false,
            includeDocs: false,
            includeSubpaths: false,
            includeDefinition: true,
            signal: request.signal,
          };
          const exports = await listModuleExports(exportRequest);
          const packageRoot = exports.packageRoot;
          if (!packageRoot) {
            throw new Error(`Package is not resolved from ${request.file}.`);
          }
          const definitionUri = exports.definitionUris[0];
          const query = [request.type, request.path.join("."), request.query]
            .filter(Boolean)
            .join(" ");
          // A package whose code lives only under `dist/` has nothing Semble
          // will index at its root — Semble ignores `dist` below a queried
          // root, and its "No supported files" is that policy speaking, not
          // an absence of code. The resolved entrypoint's own directory
          // indexes the same published files, so an unindexable root falls
          // through to it below instead of failing the whole ask.
          const packageRetrieval = await dependencies.semble
            .search({
              repo: packageRoot,
              query,
              limit: Math.min(20, request.limit * 4),
              snippetLines: null,
              signal: request.signal,
            })
            .catch((error): SembleSearchPage => {
              if (request.signal.aborted) throw error;
              return { query, results: [] };
            });
          const definitionRoot = definitionUri
            ? path.dirname(URI.parse(definitionUri).fsPath)
            : packageRoot;
          const hasAuthoredTypeScript = packageRetrieval.results.some(
            (result) =>
              !/\.d\.[cm]?ts$/u.test(result.file_path) && /\.[cm]?tsx?$/u.test(result.file_path),
          );
          const searchRoot =
            hasAuthoredTypeScript || definitionRoot === packageRoot ? packageRoot : definitionRoot;
          const retrieval =
            searchRoot === packageRoot
              ? packageRetrieval
              : await dependencies.semble.search({
                  repo: searchRoot,
                  query,
                  limit: Math.min(20, request.limit * 4),
                  snippetLines: null,
                  signal: request.signal,
                });
          const evidenceResults = retrieval.results;
          const declarations = evidenceResults.filter((result) =>
            /\.d\.[cm]?ts$/u.test(result.file_path),
          );
          const authoredTypeScript = evidenceResults.filter(
            (result) =>
              !/\.d\.[cm]?ts$/u.test(result.file_path) && /\.[cm]?tsx?$/u.test(result.file_path),
          );
          const readableJavaScript = evidenceResults.filter(
            (result) =>
              /\.[cm]?jsx?$/u.test(result.file_path) && !/\.min\.[cm]?js$/u.test(result.file_path),
          );
          const compiled = [...declarations, ...readableJavaScript].sort(
            (left, right) => right.score - left.score,
          );
          const representation = [authoredTypeScript, compiled, evidenceResults].find(
            (results) => results.length > 0,
          )!;
          const selectedEvidence = representation.filter(
            (result, index, results) =>
              results.findIndex((other) => other.content === result.content) === index,
          );
          const page = { ...retrieval, results: selectedEvidence.slice(0, request.limit) };
          const evidence = selectedEvidence.map((result) => ({
            result,
            tokens: new Set(
              `${result.file_path}\n${result.content ?? ""}`.match(/[$\p{L}_][$\p{L}\p{N}_]*/gu) ??
                [],
            ),
          }));
          const candidates = exports.items
            .flatMap((item) => {
              const match = evidence.find(({ tokens }) => tokens.has(item.label));
              return match ? [{ item, evidence: match.result }] : [];
            })
            .map((candidate) => ({
              ...candidate,
              queryMatches: queryMatchCount({
                label: candidate.item.label,
                terms: queryTerms,
              }),
            }))
            .filter(
              (candidate) =>
                candidate.queryMatches > 0 &&
                (queryRequestsErrors || !candidate.item.label.endsWith("Error")),
            )
            .sort(
              (left, right) =>
                right.queryMatches - left.queryMatches ||
                right.evidence.score - left.evidence.score,
            )
            .slice(0, request.limit);
          const resolvedExports = candidates.length
            ? await listModuleExports({
                ...exportRequest,
                labels: candidates.map(({ item }) => item.label),
                limit: candidates.length,
                includeDetails: true,
                includeDocs: true,
                includeDefinition: false,
              })
            : undefined;
          const found = (
            await enrichRetrievalPage({
              page,
              root: request.workspace,
              searchRoot,
              includeTypes: false,
              snippetLines: request.snippetLines,
              anchorIdentifiers: candidates.map(({ item }) => item.label),
              workspaces: dependencies.workspaces,
              signal: request.signal,
            })
          ).matches.filter((match) => !modulePreamble(match.content));
          // The search root reaches past the package a caller named — a bridge
          // package resolves next to the implementation it wraps — so source
          // attributed to this package must come from it. Results from
          // elsewhere are counted rather than shown under the wrong name.
          const withinPackage = displayPath(URI.file(packageRoot).toString(), request.workspace);
          const matches = found.filter((match) => match.displayFile.startsWith(withinPackage));
          const outside = found.filter((match) => !match.displayFile.startsWith(withinPackage));
          const api = (resolvedExports?.items ?? []).flatMap((item) => {
            const candidate = candidates.find((candidate) => candidate.item.label === item.label);
            return candidate ? [{ item, evidence: candidate.evidence }] : [];
          });
          return {
            requested: name,
            name: exports.packageName ?? name,
            version: exports.packageVersion,
            packageRoot,
            searchRoot,
            page,
            matches,
            elsewhere: outside.length,
            // Which files the count hides. When every result lands outside —
            // observed for a package whose install path and resolved paths
            // disagree — the count alone leaves a reader with no way to tell
            // misattribution from true neighbours.
            elsewhereFiles: [...new Set(outside.map((match) => match.displayFile))].slice(0, 3),
            api,
          };
        } catch (error) {
          if (request.signal.aborted) throw request.signal.reason;
          return {
            requested: name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const hasMatches = results.some(
      (result) => !("error" in result) && result.page.results.length > 0,
    );
    const surfaceSegments = request.type ? [request.type, ...request.path] : request.path;
    const surfaceHeading = surfaceSegments.join(".");

    const rendered = await renderDocument({
      document: "dependency-search.tool.mdoc",
      variables: {
        from: request.file,
        ranked: hasMatches,
        packages: results.map((result) => {
          if ("error" in result) return { name: result.requested, error: `Error: ${result.error}` };
          const topScore = result.matches[0]?.result.score;
          return {
            name: result.name,
            version: result.version,
            requested: result.name === result.requested ? undefined : result.requested,
            surface: surfaceHeading || undefined,
            api: result.api.map(({ item }) => ({
              name: item.label,
              signature: item.detail,
              deprecated: item.tags?.includes(1),
              documentation: markupText(item.documentation).slice(0, 220) || undefined,
            })),
            noExportMatched: result.api.length === 0,
            showSource: result.matches.length > 0 || result.elsewhere > 0,
            elsewhere: result.elsewhere,
            elsewhereFiles: result.elsewhereFiles,
            // One entry per place. The name search and the meaning search both
            // reach the same declaration, and neither knows what the other
            // found, so a two-result page spent both slots on one snippet —
            // `chokidar/types/index.d.ts:186-191` at 100% and again at 41%.
            // Matches arrive best-scored first, so the first of a repeat is the
            // one to keep: a `Map` built from all of them keeps the *last*,
            // which threw away the 100% and left a single result scored 41%
            // against a match no longer shown.
            sources: result.matches
              .filter(
                (match, index, all) =>
                  all.findIndex(
                    (seen) =>
                      seen.file === match.file && seen.contentStartLine === match.contentStartLine,
                  ) === index,
              )
              .map((match, index) => {
                const lines = match.content?.split("\n") ?? [];
                return {
                  rank: index + 1,
                  relevance:
                    topScore && topScore > 0
                      ? Math.round((match.result.score / topScore) * 100)
                      : 0,
                  file: match.displayFile,
                  startLine: match.contentStartLine + 1,
                  endLine: match.contentStartLine + Math.max(1, lines.length),
                  lines,
                };
              }),
          };
        }),
      },
    });
    return rendered.text;
  };
