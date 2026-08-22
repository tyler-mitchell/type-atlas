import {
  createTypeAtlas,
  listModuleExports,
  renderDocument,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { displayPath } from "@type-atlas/atlascii";
import * as path from "pathe";
import type { Semble } from "./semble.ts";

const render = async (variables: Record<string, unknown>): Promise<string> =>
  (await renderDocument({ document: "find-successor.tool.mdoc", variables })).text;

const tokens = (name: string): ReadonlySet<string> =>
  new Set(
    name
      .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map((part) => part.toLowerCase()),
  );

const shared = (left: ReadonlySet<string>, right: ReadonlySet<string>): readonly string[] =>
  [...left].filter((token) => right.has(token));

type Candidate = {
  readonly name: string;
  readonly evidence: string;
  readonly where?: string;
  readonly overlap: readonly string[];
};

export const createSuccessorSearch =
  (dependencies: { readonly semble: Semble; readonly workspaces: VolarWorkspacePool }) =>
  async (request: {
    readonly workspace: string;
    readonly file: string;
    readonly name: string;
    readonly module?: string;
    readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<string> => {
    const workspace = await dependencies.workspaces.get(request.workspace);
    const intelligence = createTypeAtlas(workspace);
    const wanted = tokens(request.name);

    const exported = request.module
      ? await listModuleExports({
          workspace,
          module: request.module,
          fromFile: request.file,
          path: [],
          surface: "all",
          query: "",
          labels: [request.name],
          offset: 0,
          limit: 1,
          includeDetails: true,
          includeDocs: false,
          includeSubpaths: false,
          signal: request.signal,
        }).catch(() => undefined)
      : undefined;

    const exportedAt = exported?.items.length
      ? (exported.locations?.get(request.name) ?? "declared outside this workspace")
      : undefined;

    if (exportedAt) {
      return render({
        verdict: "exported",
        name: request.name,
        module: request.module,
        declarations: [{ name: exportedAt }],
      });
    }

    const declared = await intelligence
      .workspaceSymbols({ file: request.file, query: request.name, signal: request.signal })
      .then(({ symbols }) => (symbols ?? []).filter((symbol) => symbol.name === request.name))
      .catch(() => []);

    if (declared.length) {
      // Where a declaration lives is the verdict's substance: a name whose
      // only declarations sit in test files is residue, not a capability,
      // and answering "still exists" for it sent an agent hunting for an
      // import problem that was actually a removal.
      const testFile = (file: string): boolean =>
        /(^|\/)(?:tests?|__tests__)\//u.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);
      const located = declared.map((symbol) => ({
        symbol,
        file: displayPath(symbol.location.uri, request.workspace),
      }));
      const testTotal = located.filter(({ file }) => testFile(file)).length;
      return render({
        verdict: "declared",
        name: request.name,
        module: request.module,
        declaredTotal: declared.length,
        testsOnly: testTotal === declared.length,
        declarations: located.slice(0, request.limit).map(({ symbol, file }) => ({
          name: `${file}${
            "range" in symbol.location && symbol.location.range
              ? `:${symbol.location.range.start.line + 1}:${symbol.location.range.start.character + 1}`
              : ""
          }${testFile(file) ? " · test" : ""}`,
          detail: symbol.containerName || undefined,
        })),
      });
    }

    const surface = request.module
      ? await listModuleExports({
          workspace,
          module: request.module,
          fromFile: request.file,
          path: [],
          surface: "all",
          query: [...wanted].join(" "),
          offset: 0,
          limit: request.limit * 3,
          includeDetails: true,
          includeDocs: false,
          includeSubpaths: false,
          signal: request.signal,
        }).catch(() => undefined)
      : undefined;

    const fromSurface: readonly Candidate[] = (surface?.items ?? []).map((item) => ({
      name: item.label,
      evidence: `${request.module} still exports it`,
      where: surface?.locations?.get(item.label),
      overlap: shared(wanted, tokens(item.label)),
    }));

    const nearby = await intelligence
      .workspaceSymbols({
        file: request.file,
        query: [...wanted].sort((left, right) => right.length - left.length)[0] ?? request.name,
        signal: request.signal,
      })
      .then(({ symbols }) => symbols ?? [])
      .catch(() => []);

    const fromSymbols: readonly Candidate[] = nearby.map((symbol) => ({
      name: symbol.name,
      evidence: "declared in a loaded project",
      where: displayPath(symbol.location.uri, request.workspace),
      overlap: shared(wanted, tokens(symbol.name)),
    }));

    const retrieval = await dependencies.semble
      .search({
        repo: dependencies.semble.repo(request.workspace),
        query: `${request.name} ${[...wanted].join(" ")}`,
        limit: request.limit * 2,
        snippetLines: 0,
        signal: request.signal,
      })
      .catch(() => undefined);

    const fromRetrieval: readonly Candidate[] = (retrieval?.results ?? []).map((result) => ({
      name: path.basename(result.file_path),
      evidence: "discusses this concept",
      where: path.relative(
        request.workspace,
        path.resolve(dependencies.semble.repo(request.workspace), result.file_path),
      ),
      overlap: [],
    }));

    const ranked = [...fromSurface, ...fromSymbols]
      .filter((candidate) => candidate.overlap.length > 0 && candidate.name !== request.name)
      .sort((left, right) => right.overlap.length - left.overlap.length)
      .filter(
        (candidate, index, all) =>
          all.findIndex((other) => other.name === candidate.name) === index,
      )
      .slice(0, request.limit);

    const searched = [
      request.module ? `the current ${request.module} surface` : undefined,
      "symbols declared in loaded projects",
      retrieval ? "the semantic index" : undefined,
    ]
      .filter(Boolean)
      .join(", ");

    return render({
      verdict: "removed",
      name: request.name,
      module: request.module,
      searched,
      candidates: ranked.map((candidate) => ({
        name: candidate.name,
        fields: [candidate.evidence, `shares ${candidate.overlap.join(", ")}`, candidate.where],
      })),
      // One row per file: retrieval returns a result per matching chunk, and
      // the same document listed three times read as three findings.
      discussing: [...new Set(fromRetrieval.map((candidate) => candidate.where ?? candidate.name))]
        .slice(0, request.limit)
        .map((name) => ({ name })),
    });
  };
