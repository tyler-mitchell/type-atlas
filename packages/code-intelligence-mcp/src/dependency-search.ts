import type { VolarWorkspacePool } from "@featuretype/code-intelligence";
import { workspacePath } from "@featuretype/code-intelligence/text";
import {
  ResolveDependencySourceRequest,
} from "@featuretype/code-intelligence-language-server/protocol";
import * as path from "pathe";
import { URI } from "vscode-uri";
import type { Semble, SembleSearchPage } from "./semble.ts";

type DependencySearchResult =
  | {
    readonly requested: string;
    readonly name: string;
    readonly version: string;
    readonly packageRoot: string;
    readonly searchRoot: string;
    readonly page: SembleSearchPage;
  }
  | {
    readonly requested: string;
    readonly error: string;
  };

const formatResult = (
  input: {
    readonly workspace: string;
    readonly root: string;
    readonly result: SembleSearchPage["results"][number];
  },
): string => [
  `${
    workspacePath(
      URI.file(path.resolve(input.root, input.result.file_path)).toString(),
      input.workspace,
    )
  }:${input.result.start_line}-${input.result.end_line}`,
  ...(input.result.content
    ? input.result.content.split("\n").map((line, index) =>
      `${input.result.start_line + index}|${line}`
    )
    : []),
].join("\n");

export const createDependencySearch = (
  dependencies: {
    readonly semble: Semble;
    readonly workspaces: VolarWorkspacePool;
  },
) =>
async (
  request: {
    readonly workspace: string;
    readonly file: string;
    readonly packages: readonly string[];
    readonly query: string;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  },
): Promise<string> => {
  const workspace = await dependencies.workspaces.get(request.workspace);
  const results = await Promise.all(
    request.packages.map(
      async (name): Promise<DependencySearchResult> => {
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
          const searchRoot = subModuleName.includes("/")
            ? path.join(
              packageRoot,
              subModuleName.slice(0, subModuleName.indexOf("/")),
            )
            : packageRoot;

          return {
            requested: name,
            name: resolved.packageId.name,
            version: resolved.packageId.version,
            packageRoot,
            searchRoot,
            page: await dependencies.semble.search({
              repo: searchRoot,
              query: request.query,
              limit: request.limit,
              snippetLines: request.snippetLines,
              signal: request.signal,
            }),
          };
        } catch (error) {
          if (request.signal.aborted) throw request.signal.reason;
          return {
            requested: name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    ),
  );
  const hasMatches = results.some((result) =>
    !("error" in result) && result.page.results.length > 0
  );

  return [
    `Search installed dependencies from ${request.file}`,
    `Query: ${request.query}`,
    ...(hasMatches
      ? ["Relevance: percentages are relative to the top result shown for each package."]
      : []),
    "",
    ...results.flatMap((result) => {
      const topScore = "error" in result
        ? undefined
        : result.page.results[0]?.score;
      return [
        `## ${"error" in result
          ? result.requested
          : `${result.name}@${result.version}${
            result.name === result.requested
              ? ""
              : ` · requested ${result.requested}`
          }`}`,
        ...("error" in result
          ? [`Error: ${result.error}`]
          : [
            `Root: ${
              workspacePath(
                URI.file(result.packageRoot).toString(),
                request.workspace,
              )
            }`,
            `${result.page.results.length} ${
              result.page.results.length === 1 ? "match" : "matches"
            }`,
            "",
            ...result.page.results.flatMap((match, index) => [
              `### ${index + 1} · relevance ${
                topScore && topScore > 0
                  ? Math.round((match.score / topScore) * 100)
                  : 0
              }%`,
              formatResult({
                workspace: request.workspace,
                root: result.searchRoot,
                result: match,
              }),
              "",
            ]),
          ]),
        "",
      ];
    }),
  ].join("\n").trimEnd();
};
