import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/server";
import { type Location } from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import {
  createTypeAtlas,
  declarationChainAtPosition,
  projectSources,
  renderDocument,
  subjectAtPosition,
  type VolarWorkspace,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type } from "arktype";
import { displayPath, truncate } from "@type-atlas/atlascii";
import * as path from "pathe";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
import { registerTool } from "./tool.ts";
import { fileInput } from "./tool-input.ts";
import { findOccurrenceCandidates } from "./occurrence-candidates.ts";

const input = type({
  workspace: fileInput.workspace,
  "query?": type("string >= 1").configure({
    description:
      "One exact identifier or expression. Identifiers resolve semantic references; expressions match syntax structurally and receive semantic annotations.",
  }),
  "queries?": type("string >= 1")
    .array()
    .atLeastLength(1)
    .atMostLength(5)
    .configure(
      { description: "Several exact identifiers or expressions to resolve in one investigation." },
      "self",
    ),
  "path?": type("string >= 1").configure({
    description: "Workspace-relative file or directory that bounds candidates and returned uses.",
  }),
  "paths?": type("string >= 1")
    .array()
    .atLeastLength(1)
    .atMostLength(5)
    .configure(
      { description: "Several files or directories to search together. Pass path or paths." },
      "self",
    ),
  "symbolLimit?": type("1 <= number.integer <= 20").configure({
    default: 5,
    description: "Maximum distinct canonical symbols inspected across every requested name.",
  }),
  "offset?": type("0 <= number.integer <= 10000").configure({
    default: 0,
    description: "Number of leading semantic references to skip across every resolved symbol.",
  }),
  "limit?": type("1 <= number.integer <= 100").configure({
    default: 20,
    description: "Maximum semantic references returned across every resolved symbol.",
  }),
});

type Scope = { readonly absolute: string; readonly relative: string; readonly file: boolean };
type Subject = {
  readonly query: number;
  readonly declaration: Location;
  readonly declarations: readonly Location[];
  readonly references: readonly Location[];
  readonly name: string;
  readonly word: string;
  readonly container?: string;
};

const filePriority = (file: string): number => {
  if (/(^|\/)tests?\/|\.(test|spec|check)\./u.test(file)) return 1;
  return /\.d\.[cm]?ts$/u.test(file) ? 2 : 0;
};

const orderLocations = (root: string, locations: readonly Location[]): Location[] =>
  [...locations].sort(
    (left, right) =>
      filePriority(displayPath(left.uri, root)) - filePriority(displayPath(right.uri, root)) ||
      displayPath(left.uri, root).localeCompare(displayPath(right.uri, root)) ||
      left.range.start.line - right.range.start.line ||
      left.range.start.character - right.range.start.character,
  );

const pathInScope = (absolute: string, scopes: readonly Scope[]): boolean =>
  scopes.some((scope) =>
    scope.file
      ? absolute === scope.absolute
      : absolute === scope.absolute || isFileInDir(absolute, scope.absolute),
  );

const inScope = (uri: string, scopes: readonly Scope[]): boolean =>
  pathInScope(fileURLToPath(uri), scopes);

const identity = (location: Location): string =>
  `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;

const roundRobin = <Value>(sequences: readonly (readonly Value[])[], count: number): Value[] => {
  const selected: Value[] = [];
  for (let index = 0; selected.length < count; index += 1) {
    const available = sequences.flatMap((sequence) => (sequence[index] ? [sequence[index]] : []));
    if (available.length === 0) break;
    selected.push(...available.slice(0, count - selected.length));
  }
  return selected;
};

const compactSourceLines = <
  Site extends {
    readonly file: string;
    readonly line: number;
    readonly character: number;
    readonly within?: string;
    readonly text?: string;
  },
>(
  sites: readonly Site[],
) =>
  [
    ...Map.groupBy(
      sites,
      ({ file, line, within, text }) => `${file}:${line}:${within ?? ""}:${text ?? ""}`,
    ),
  ].map(([, matching]) => ({
    ...matching[0]!,
    characters: matching.map(({ character }) => character),
  }));

export const semanticOccurrences = async (input: {
  readonly root: string;
  readonly workspace: VolarWorkspace;
  readonly queries: readonly string[];
  readonly paths: readonly string[];
  readonly symbolLimit: number;
  readonly offset: number;
  readonly limit: number;
  readonly signal: AbortSignal;
}) => {
  const root = path.resolve(input.root);
  const scopes = await Promise.all(
    input.paths.map(async (requested): Promise<Scope> => {
      const absolute = path.resolve(root, requested);
      if (absolute !== root && !isFileInDir(absolute, root)) {
        throw new Error(`Path is outside the workspace: ${requested}`);
      }
      const found = await stat(absolute).catch(() => undefined);
      if (!found?.isFile() && !found?.isDirectory()) {
        throw new Error(`No regular file or directory at ${requested} in this workspace.`);
      }
      return { absolute, relative: path.relative(root, absolute) || ".", file: found.isFile() };
    }),
  );
  const projects = projectSources(root);
  const sourceFiles = [
    ...new Set(projects.flatMap(({ files }) => files).filter((file) => pathInScope(file, scopes))),
  ];
  const candidates = await findOccurrenceCandidates({
    root,
    queries: input.queries,
    files: sourceFiles,
    signal: input.signal,
  });
  const intelligence = createTypeAtlas(input.workspace);
  const remaining = candidates.map(({ positions }) => [...positions]);
  const unmatched = input.queries.map(
    (): { readonly file: string; readonly position: { line: number; character: number } }[] => [],
  );
  const seen = input.queries.map(() => new Set<string>());
  const projectFiles = [
    ...new Set(candidates.flatMap(({ positions }) => positions.map(({ file }) => file))),
  ];
  const subjects: Subject[] = [];
  while (subjects.length < input.symbolLimit) {
    let progressed = false;
    for (const [query, pending] of remaining.entries()) {
      if (subjects.length === input.symbolLimit) break;
      const seed = pending.shift();
      if (!seed) continue;
      progressed = true;
      const answer = await intelligence.definitions({
        file: seed.file,
        signal: input.signal,
        params: { position: seed.position },
      });
      const raw = !answer.result
        ? []
        : Array.isArray(answer.result)
          ? answer.result
          : [answer.result];
      const declarations = orderLocations(root, [
        ...new Map(
          raw
            .map((definition) =>
              "targetUri" in definition
                ? {
                    uri: definition.targetUri,
                    range: definition.targetSelectionRange,
                  }
                : definition,
            )
            .filter((location) => {
              const file = fileURLToPath(location.uri);
              return (
                existsSync(file) &&
                !/(^|\/)node_modules\//u.test(path.normalize(file)) &&
                inScope(location.uri, [{ absolute: root, relative: ".", file: false }])
              );
            })
            .map((location) => [identity(location), location]),
        ).values(),
      ]);
      if (declarations.length === 0) {
        unmatched[query]?.push(seed);
        continue;
      }
      const symbolIdentity = declarations.map(identity).sort().join("|");
      if (seen[query]?.has(symbolIdentity)) continue;
      seen[query]?.add(symbolIdentity);
      const declaration = declarations.toSorted(
        (left, right) =>
          right.range.start.line - left.range.start.line ||
          right.range.start.character - left.range.start.character,
      )[0]!;
      const referencesAnswer = await intelligence.references({
        file: displayPath(declaration.uri, root),
        signal: input.signal,
        params: {
          position: declaration.range.start,
          context: { includeDeclaration: false },
          scope: "workspace",
          projectFiles: subjects.length === 0 ? projectFiles : undefined,
        },
      });
      const found = [
        ...new Map(
          ((referencesAnswer.result ?? []) as readonly Location[]).map((location) => [
            identity(location),
            location,
          ]),
        ).values(),
      ];
      const candidateLocations = new Set(
        (candidates[query]?.positions ?? []).map(
          ({ file, position }) => `${file}:${position.line}:${position.character}`,
        ),
      );
      const matchingReferences =
        candidates[query]?.kind === "expression"
          ? found.filter((location) =>
              candidateLocations.has(
                `${displayPath(location.uri, root)}:${location.range.start.line}:${location.range.start.character}`,
              ),
            )
          : found;
      const covered = new Set(
        [
          ...found.map((location) => ({
            file: displayPath(location.uri, root),
            position: location.range.start,
          })),
          ...declarations.map((location) => ({
            file: displayPath(location.uri, root),
            position: location.range.start,
          })),
          seed,
        ].map(({ file, position }) => `${file}:${position.line}:${position.character}`),
      );
      remaining[query] = pending.filter(
        ({ file, position }) => !covered.has(`${file}:${position.line}:${position.character}`),
      );
      unmatched[query] = (unmatched[query] ?? []).filter(
        ({ file, position }) => !covered.has(`${file}:${position.line}:${position.character}`),
      );
      const [canonical, chain] = await Promise.all([
        subjectAtPosition({
          workspace: input.workspace,
          uri: declaration.uri,
          position: declaration.range.start,
          signal: input.signal,
        }).catch(() => undefined),
        declarationChainAtPosition({
          workspace: input.workspace,
          uri: declaration.uri,
          position: declaration.range.start,
        }).catch(() => []),
      ]);
      const declarationLocations = new Set(declarations.map(identity));
      const references = orderLocations(
        root,
        matchingReferences
          .filter((location) => !declarationLocations.has(identity(location)))
          .filter((location) => inScope(location.uri, scopes)),
      );
      subjects.push({
        query,
        declaration,
        declarations,
        references,
        name: canonical?.name ?? candidates[query]?.anchor ?? input.queries[query]!,
        word: canonical?.kind ?? "symbol",
        container: enclosingDeclaration(chain, declaration.range)?.name,
      });
    }
    if (!progressed) break;
  }
  const totalReferences = subjects.reduce((total, subject) => total + subject.references.length, 0);
  const page = roundRobin(
    subjects.map((subject) => subject.references.map((reference) => ({ subject, reference }))),
    input.offset + input.limit,
  ).slice(input.offset);
  const sourceLines = new Map<string, Promise<readonly string[]>>();
  const linesFor = (uri: string) => {
    const held = sourceLines.get(uri);
    if (held) return held;
    const reading = input.workspace
      .readTextDocumentUri(uri, input.signal)
      .then(({ source }) => source.split("\n"));
    sourceLines.set(uri, reading);
    return reading;
  };
  const named = await Promise.all(
    page.map(async ({ subject, reference }) => {
      const [chain, lines] = await Promise.all([
        declarationChainAtPosition({
          workspace: input.workspace,
          uri: reference.uri,
          position: reference.range.start,
        }).catch(() => []),
        linesFor(reference.uri),
      ]);
      return {
        subject,
        file: displayPath(reference.uri, root),
        line: reference.range.start.line + 1,
        character: reference.range.start.character + 1,
        within: enclosingDeclaration(chain, reference.range)?.name,
        text: truncate({
          value: (lines[reference.range.start.line] ?? "").trim(),
          columns: 180,
        }),
      };
    }),
  );
  const unresolved = await Promise.all(
    candidates.map(async (candidate, query) => {
      const positions = unmatched[query] ?? [];
      const sites = await Promise.all(
        positions.slice(0, 3).map(async ({ file, position }) => {
          const uri = input.workspace.getWorkspaceUri(file);
          const [chain, lines] = await Promise.all([
            declarationChainAtPosition({
              workspace: input.workspace,
              uri,
              position,
            }).catch(() => []),
            linesFor(uri),
          ]);
          return {
            file,
            line: position.line + 1,
            character: position.character + 1,
            within: enclosingDeclaration(chain, {
              start: position,
              end: {
                line: position.line,
                character: position.character + candidate.anchor.length,
              },
            })?.name,
            text: truncate({
              value: (lines[position.line] ?? "").trim(),
              columns: 180,
            }),
          };
        }),
      );
      return { total: positions.length, groups: referenceGroups(sites) };
    }),
  );
  const queries = candidates.map((candidate, query) => {
    const inspected = subjects.filter((subject) => subject.query === query);
    const remainingCandidates = remaining[query]?.length ?? 0;
    const presented = inspected
      .map((subject) => ({
        kind: candidate.kind,
        name: subject.name,
        word: subject.word,
        container: subject.container === subject.name ? undefined : subject.container,
        file: displayPath(subject.declaration.uri, root),
        at: `${subject.declaration.range.start.line + 1}:${subject.declaration.range.start.character + 1}`,
        declarations: subject.declarations.length,
        total: subject.references.length,
        shown: named.filter((site) => site.subject === subject).length,
        ...(inspected.length === 1 && remainingCandidates === 0
          ? {
              candidateTotal: candidate.total,
              candidateFiles: candidate.files.size,
              unresolved: unresolved[query]?.total ?? 0,
              unresolvedGroups: unresolved[query]?.groups ?? [],
            }
          : {}),
        groups: referenceGroups(
          compactSourceLines(
            named
              .filter((site) => site.subject === subject)
              .map(({ file, line, character, within, text }) => ({
                file,
                line,
                character,
                within,
                text,
              })),
          ),
        ),
      }))
      .filter(({ shown, total }) => shown > 0 || total === 0);
    return {
      kind: candidate.kind,
      name: candidate.query,
      candidateTotal: candidate.total,
      candidateFiles: candidate.files.size,
      subjectCount: inspected.length,
      presentedCount: presented.length,
      remainingCandidates,
      references: inspected.reduce((total, subject) => total + subject.references.length, 0),
      unresolved: unresolved[query]?.total ?? 0,
      unresolvedGroups: unresolved[query]?.groups ?? [],
      subjects: presented,
    };
  });
  const kinds = new Set(candidates.map(({ kind }) => kind));
  return {
    queryLabel:
      kinds.size > 1
        ? "Queries"
        : kinds.has("expression")
          ? candidates.length === 1
            ? "Expression"
            : "Expressions"
          : "Identifiers",
    queryText: input.queries.map((query) => JSON.stringify(query)).join(", "),
    scopes: scopes.map(({ relative }) => (relative === "." ? "workspace" : relative)).join(" + "),
    sourceFiles: sourceFiles.length,
    page:
      input.offset > 0 || totalReferences > page.length
        ? {
            from: page.length === 0 ? 0 : input.offset + 1,
            to: input.offset + page.length,
            total: totalReferences,
            next:
              input.offset + page.length < totalReferences ? input.offset + page.length : undefined,
          }
        : undefined,
    queries,
  };
};

export const registerOccurrenceTool = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "occurrences",
    {
      title: "Occurrences",
      description:
        "Find exact identifiers or expressions without knowing their files. Identifier queries resolve semantic references; expression queries match AST structure and receive Volar annotations. Use search_code for meaning-based retrieval.",
      inputSchema: input,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        query,
        queries,
        path: requestedPath,
        paths,
        symbolLimit = 5,
        offset = 0,
        limit = 20,
      },
      { mcpReq: { signal } },
    ) => {
      if (Boolean(query) === Boolean(queries)) throw new Error("Pass query or queries, not both.");
      if (requestedPath && paths) throw new Error("Pass path or paths, not both.");
      const requested = queries ?? (query ? [query] : []);
      if (new Set(requested).size !== requested.length)
        throw new Error("Every query must be unique.");
      const result = await semanticOccurrences({
        root,
        workspace: await workspaces.get(root),
        queries: requested,
        paths: paths ?? [requestedPath ?? "."],
        symbolLimit,
        offset,
        limit,
        signal,
      });
      const rendered = await renderDocument({
        document: "occurrences.tool.mdoc",
        variables: result,
      });
      return textResult(rendered.text);
    },
  );
};
