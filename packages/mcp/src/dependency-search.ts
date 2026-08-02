import { listModuleExports, type ModuleExportPage, type VolarWorkspacePool } from "@typeatlas/core";
import { formatModuleDeclarations, workspacePath } from "@typeatlas/core/text";
import { ResolveDependencySourceRequest } from "@typeatlas/language-server/protocol";
import * as path from "pathe";
import PQueue from "p-queue";
import { URI } from "vscode-uri";
import { enrichRetrievalPage, type RetrievalMatch } from "./intelligence.ts";
import type { Semble, SembleSearchPage } from "./semble.ts";

type DependencySearchResult =
  | {
      readonly requested: string;
      readonly name: string;
      readonly version: string;
      readonly packageRoot: string;
      readonly searchRoot: string;
      readonly page: SembleSearchPage;
      readonly matches: readonly RetrievalMatch[];
      readonly api: readonly {
        readonly item: ModuleExportPage["items"][number];
        readonly evidence: SembleSearchPage["results"][number];
      }[];
    }
  | {
      readonly requested: string;
      readonly error: string;
    };

const dependencySearchQueue = new PQueue({ concurrency: 2 });

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
      request.packages.map((name) =>
        dependencySearchQueue.add(
          async (): Promise<DependencySearchResult> => {
            try {
              const resolved = await workspace.sendRequest(
                ResolveDependencySourceRequest.type,
                {
                  textDocument: {
                    uri: workspace.getWorkspaceUri(request.file),
                  },
                  moduleName: name,
                },
                request.signal,
              );
              if (!resolved?.packageId) {
                throw new Error(`Package is not resolved from ${request.file}.`);
              }

              const subModuleName = resolved.packageId.subModuleName;
              const packageRoot = subModuleName
                ? resolved.resolvedFileName.slice(0, -subModuleName.length)
                : path.dirname(resolved.resolvedFileName);
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
              const definitionUri = exports.definitionUris[0];
              const query = [request.type, request.path.join("."), request.query]
                .filter(Boolean)
                .join(" ");
              const packageRetrieval = await dependencies.semble.search({
                repo: packageRoot,
                query,
                limit: Math.min(20, request.limit * 4),
                snippetLines: null,
                signal: request.signal,
              });
              const definitionRoot = definitionUri
                ? path.dirname(URI.parse(definitionUri).fsPath)
                : packageRoot;
              const hasAuthoredTypeScript = packageRetrieval.results.some(
                (result) =>
                  !/\.d\.[cm]?ts$/u.test(result.file_path) &&
                  /\.[cm]?tsx?$/u.test(result.file_path),
              );
              const searchRoot =
                hasAuthoredTypeScript || definitionRoot === packageRoot
                  ? packageRoot
                  : definitionRoot;
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
                  !/\.d\.[cm]?ts$/u.test(result.file_path) &&
                  /\.[cm]?tsx?$/u.test(result.file_path),
              );
              const readableJavaScript = evidenceResults.filter(
                (result) =>
                  /\.[cm]?jsx?$/u.test(result.file_path) &&
                  !/\.min\.[cm]?js$/u.test(result.file_path),
              );
              const representation = [
                authoredTypeScript,
                declarations,
                readableJavaScript,
                evidenceResults,
              ].find((results) => results.length > 0)!;
              const selectedEvidence = representation.filter(
                (result, index, results) =>
                  results.findIndex((other) => other.content === result.content) === index,
              );
              const page = { ...retrieval, results: selectedEvidence.slice(0, request.limit) };
              const evidence = selectedEvidence.map((result) => ({
                result,
                tokens: new Set(
                  `${result.file_path}\n${result.content ?? ""}`.match(
                    /[$\p{L}_][$\p{L}\p{N}_]*/gu,
                  ) ?? [],
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
              const matches = (
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
              ).matches;
              const api = (resolvedExports?.items ?? []).flatMap((item) => {
                const candidate = candidates.find(
                  (candidate) => candidate.item.label === item.label,
                );
                return candidate ? [{ item, evidence: candidate.evidence }] : [];
              });
              return {
                requested: name,
                name: resolved.packageId.name,
                version: resolved.packageId.version,
                packageRoot,
                searchRoot,
                page,
                matches,
                api,
              };
            } catch (error) {
              if (request.signal.aborted) throw request.signal.reason;
              return {
                requested: name,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { signal: request.signal },
        ),
      ),
    );
    const hasMatches = results.some(
      (result) => !("error" in result) && result.page.results.length > 0,
    );
    const surfaceSegments = request.type ? [request.type, ...request.path] : request.path;
    const surfaceHeading = surfaceSegments.join(".");

    return [
      `From ${request.file}`,
      ...(hasMatches ? ["Relative relevance within each package."] : []),
      "",
      ...results.flatMap((result) => {
        const topScore = "error" in result ? undefined : result.matches[0]?.result.score;
        return [
          `## ${
            "error" in result
              ? result.requested
              : `${result.name}@${result.version}${
                  result.name === result.requested ? "" : ` (requested as ${result.requested})`
                } · ${workspacePath(URI.file(result.packageRoot).toString(), request.workspace)}`
          }`,
          ...("error" in result
            ? [`Error: ${result.error}`]
            : [
                "",
                ...(result.api.length
                  ? [
                      ...(surfaceHeading ? [`### ${surfaceHeading}`] : []),
                      formatModuleDeclarations({
                        items: result.api.map(({ item }) => item),
                        qualifier: surfaceHeading,
                        includeDocs: true,
                        documentationLimit: 220,
                      }),
                      "",
                      "### Relevant source",
                    ]
                  : []),
                ...result.matches.flatMap((match, index) => {
                  const source = match.content?.split("\n") ?? [];
                  const startLine = match.contentStartLine + 1;
                  const endLine = startLine + Math.max(0, source.length - 1);
                  return [
                    `${index + 1}. ${
                      topScore && topScore > 0
                        ? Math.round((match.result.score / topScore) * 100)
                        : 0
                    }% · ${match.displayFile}:${startLine}-${endLine}`,
                    "```text",
                    ...source.map((line, offset) => `${startLine + offset}|${line}`),
                    "```",
                    "",
                  ];
                }),
              ]),
          "",
        ];
      }),
    ]
      .join("\n")
      .trimEnd();
  };
