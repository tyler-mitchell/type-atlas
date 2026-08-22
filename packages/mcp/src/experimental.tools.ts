import { readFile, stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/server";
import { fdir } from "fdir";
import { isGitIgnored } from "globby";
import * as path from "pathe";
import {
  type Diagnostic,
  type DocumentSymbol,
  DocumentDiagnosticRequest,
  GetMatchTsConfigRequest,
  type SymbolInformation,
} from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import {
  createTypeAtlas,
  declarationChainAtPosition,
  documentSymbols,
  projectGraph,
  renderComposition,
  renderDocument,
  subjectAtPosition,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type } from "arktype";
import { displayPath, markupText, positionText, rangeText, sameRange } from "@type-atlas/atlascii";
import { type DocumentAsk, documentAsks, isAskReference } from "@type-atlas/atlascii/document";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { createQuorl } from "./quorl.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
import type { Semble } from "./semble.ts";
import { registerTool } from "./tool.ts";
import { fileInput, positionInput } from "./tool-input.ts";

const input = type.module({
  Quorl: type({
    ...fileInput,
    position: positionInput.configure(
      { description: "Position of the symbol whose closure should be expanded." },
      "self",
    ),
    "depth?": type("1 <= number.integer <= 4").configure({
      default: 2,
      description: "How many hops of enclosing declarations to follow.",
    }),
    "limit?": type("1 <= number.integer <= 200").configure({
      default: 40,
      description: "Maximum declarations expanded before the rest are reported as a frontier.",
    }),
  }),
  Impact: type({
    ...fileInput,
    position: positionInput.configure(
      { description: "Position of the symbol whose change is being weighed." },
      "self",
    ),
  }),
  VerifyEdit: type({
    workspace: fileInput.workspace,
    files: type({
      path: type("string >= 1").describe("Workspace-relative or absolute file path."),
      content: type("string").describe("The file's complete proposed content."),
    })
      .array()
      .atLeastLength(1)
      .atMostLength(5)
      .configure(
        { description: "Proposed contents to check, before anything is written." },
        "self",
      ),
  }),
  Compose: type({
    workspace: fileInput.workspace,
    document: type("string >= 1").configure({
      description: "Markdoc source: ask declarations followed by a body composing what they bind.",
    }),
  }),
  Occurrences: type({
    workspace: fileInput.workspace,
    text: type("string >= 1").configure({
      description: "The exact text to find — literal, not a pattern or a meaning.",
    }),
    "directory?": type("string >= 1").configure({
      description: "Workspace-relative directory to scan. Defaults to the workspace.",
    }),
    "limit?": type("1 <= number.integer <= 200").configure({
      default: 40,
      description: "Maximum occurrences returned; the totals count every one found.",
    }),
  }),
});

/** One diagnostic's identity across an edit, where ranges shift but meaning holds. */
const diagnosticKey = (entry: {
  readonly severity?: number;
  readonly code?: number | string;
  readonly message: string;
}) => `${entry.severity ?? 1}|${entry.code ?? ""}|${entry.message}`;

/** The workspace package a display path belongs to, as a reader names it. */
const packageOf = (file: string) => {
  const segments = file.split("/");
  return segments.length === 1
    ? "workspace root"
    : segments[0] === "packages" || segments[0] === "apps"
      ? segments.slice(0, 2).join("/")
      : (segments[0] ?? "workspace root");
};

/** Whether a use sits in a test file, by the paths tests conventionally hold. */
const isTestSite = (file: string) => /(^|\/)tests?\/|\.(test|spec|check)\./u.test(file);

/**
 * Every place an exact text occurs under a directory, and the honest scan
 * count behind an absence claim. One owner, two askers: the occurrences tool
 * and the compose op — the gateway that reaches a live session no schema
 * change can.
 */
const scanOccurrences = async (input: {
  readonly root: string;
  readonly text: string;
  readonly directory: string;
  readonly limit: number;
  readonly signal: AbortSignal;
}) => {
  const workspaceRoot = path.resolve(input.root);
  const scanRoot = path.resolve(workspaceRoot, input.directory);
  if (scanRoot !== workspaceRoot && !isFileInDir(scanRoot, workspaceRoot)) {
    throw new Error(`Directory is outside the workspace: ${input.directory}`);
  }
  // A wrong argument answers about the argument: without this, a file passed
  // as the directory surfaced as `ENOTDIR … lstat …/.gitignore` from the
  // ignore walk — an errno about a file nobody named.
  if (!(await stat(scanRoot).catch(() => undefined))?.isDirectory()) {
    throw new Error(
      `No directory at ${input.directory} in this workspace. Pass a directory to scan, and check the path.`,
    );
  }
  // The same walk list_files answers from: gitignore honored, dependency
  // and VCS internals excluded — an absence claim is only as strong as
  // the set it scanned, and this is the set a reader expects.
  const isIgnored = await isGitIgnored({
    cwd: scanRoot,
    followSymbolicLinks: false,
    ignore: ["**/.git/**", "**/node_modules/**"],
  });
  const fileBudget = 4000;
  const files = await new fdir()
    .withPathSeparator("/")
    .withRelativePaths()
    .withMaxFiles(fileBudget + 1)
    .withErrors()
    .withAbortSignal(input.signal)
    .filter((file) => !isIgnored(file))
    .exclude((name) => name === ".git" || name === "node_modules" || name.startsWith("."))
    .crawl(scanRoot)
    .withPromise();
  // Generated output is not source: a committed dist/ drowned a string-id
  // search in minified bundle hits (kek-monorepo, 2026-08-20). The tsconfig
  // outDirs discovered from the workspace's own configuration are excluded —
  // and disclosed, because an absence claim is only as strong as its scan
  // set. Scanning inside an outDir on purpose still works: the exclusion
  // applies only when the scan root is outside them all.
  const outDirs = projectGraph(workspaceRoot).outDirs.map((dir) =>
    path.resolve(workspaceRoot, dir),
  );
  const insideGenerated = outDirs.some((dir) => scanRoot === dir || isFileInDir(scanRoot, dir));
  const generatedFile = (relative: string): boolean => {
    const absolute = path.resolve(scanRoot, relative);
    return outDirs.some((dir) => isFileInDir(absolute, dir));
  };
  const authored = insideGenerated ? files : files.filter((file) => !generatedFile(file));
  const generatedExcluded = files.length - authored.length;
  const over = authored.length > fileBudget;
  // Lexicographic, not crawl order: the filesystem's traversal order is not
  // deterministic, and an answer that reorders between identical runs cannot
  // be compared across changes — the same file set must read the same way.
  const scanned = [...authored].sort().slice(0, fileBudget);
  const sites: { file: string; line: number; character: number; text: string }[] = [];
  let total = 0;
  const seenFiles = new Set<string>();
  for (const relative of scanned) {
    const source = await readFile(path.resolve(scanRoot, relative), "utf8").catch(() => undefined);
    // A NUL byte marks content no reader lines up; skipped, not counted.
    if (source === undefined || source.includes("\0")) continue;
    if (!source.includes(input.text)) continue;
    const display = path.relative(workspaceRoot, path.resolve(scanRoot, relative));
    for (const [index, line] of source.split("\n").entries()) {
      for (
        let at = line.indexOf(input.text);
        at !== -1;
        at = line.indexOf(input.text, at + Math.max(1, input.text.length))
      ) {
        total += 1;
        seenFiles.add(display);
        if (sites.length < input.limit) {
          // Windowed around the match, never the whole line: a minified
          // bundle carries one line of half a megabyte, and fifteen matched
          // rows once rendered a 600KB answer no client would deliver.
          const window =
            line.trim().length <= 160
              ? line.trim()
              : line.slice(Math.max(0, at - 60), at + input.text.length + 60).trim();
          sites.push({
            file: display,
            line: index + 1,
            character: at + 1,
            text: line.trim().length <= 160 ? window : `… ${window} …`,
          });
        }
      }
    }
  }
  const groups = [...Map.groupBy(sites, ({ file }) => file)].map(([file, held]) =>
    held.length === 1 && held[0]
      ? { file, at: `${held[0].line}:${held[0].character}`, text: held[0].text }
      : {
          file,
          children: held.map((site) => ({
            at: `${site.line}:${site.character}`,
            column: Math.max(...held.map(({ line, character }) => `${line}:${character}`.length)),
            text: site.text,
          })),
        },
  );
  return {
    text: input.text,
    directory: path.relative(workspaceRoot, scanRoot) === "" ? "the workspace" : input.directory,
    total,
    fileCount: seenFiles.size,
    scanned: scanned.length,
    over,
    generatedExcluded: generatedExcluded > 0 ? generatedExcluded : undefined,
    groups,
    page:
      total > sites.length ? { from: 1, to: sites.length, total, unit: "occurrences" } : undefined,
  };
};

export const registerExperimentalTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const quorl = createQuorl({ workspaces });

  registerTool(
    server,
    "verify_edit",
    {
      title: "Verify edit",
      description:
        "Experimental: the diagnostics a proposed edit would introduce, before anything is written. Each file's complete proposed content is checked in memory against the file as it stands; the answer reports what the change introduces and resolves in those files. A change can also break importers — diagnostics after applying reports those.",
      inputSchema: input.VerifyEdit,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, files }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const checked = await Promise.all(
        files.map(async ({ path: file, content }) => {
          const { uri } = await workspace.getTextDocument(file);
          const report = (result: unknown) =>
            result && typeof result === "object" && "items" in result
              ? ((result as { items: readonly Diagnostic[] }).items ?? [])
              : [];
          const baseline = report(
            await workspace.sendRequest(
              DocumentDiagnosticRequest.type,
              {
                textDocument: { uri },
              },
              signal,
            ),
          ).filter((entry) => (entry.severity ?? 1) <= 2);
          const proposed = await workspace.withTextDocument({
            uri,
            languageId: "typescript",
            source: content,
            signal,
            task: async (textDocument) =>
              report(
                await workspace.sendRequest(
                  DocumentDiagnosticRequest.type,
                  {
                    textDocument,
                  },
                  signal,
                ),
              ).filter((entry) => (entry.severity ?? 1) <= 2),
          });
          const standing = new Map<string, number>();
          for (const entry of baseline) {
            standing.set(diagnosticKey(entry), (standing.get(diagnosticKey(entry)) ?? 0) + 1);
          }
          const introduced = proposed.filter((entry) => {
            const held = standing.get(diagnosticKey(entry)) ?? 0;
            if (held === 0) return true;
            standing.set(diagnosticKey(entry), held - 1);
            return false;
          });
          const resolved = [...standing.values()].reduce((total, count) => total + count, 0);
          return {
            file: displayPath(uri, root),
            introduced: introduced.map((entry) => ({
              severity: entry.severity,
              source: entry.source,
              code: entry.code,
              range: entry.range,
              message: entry.message,
            })),
            resolvedCount: resolved,
          };
        }),
      );
      const rendered = await renderDocument({
        document: "verify-edit.tool.mdoc",
        variables: {
          fileCount: checked.length,
          introducedCount: checked.reduce((total, { introduced }) => total + introduced.length, 0),
          resolvedCount: checked.reduce((total, { resolvedCount }) => total + resolvedCount, 0),
          groups: checked
            .filter(({ introduced }) => introduced.length > 0)
            .map(({ file, introduced }) => ({ file, problems: introduced })),
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "compose",
    {
      title: "Compose",
      description:
        'Experimental: author your own code-intelligence answer as one markup document. You define all of it: self-closing ask tags declare the data and render nothing; the body you write is the entire answer, composing what the asks bind with the shipped tags and partials — {% $uses.total %}, {% tree entries=$uses.groups partial="reference-node.mdoc" /%}, headings, prose. Asks chain: a later ask reads an earlier answer, e.g. {% ask "diagnostics" as="health" files=$uses.paths /%} checks the files the reference search found. A document with no body renders nothing — the markup is yours, not the tool\'s.\n\nOperations and what each binds:\n- {% ask "hover" as="head" file="src/x.ts" line=5 character=10 /%} (one-based, on the symbol\'s name) → {text}: the signature and documentation, rendered with {% $head.text %}\n- {% ask "references" as="uses" file="src/x.ts" line=5 character=10 /%} → {total, files, paths, projects, groups}; render sites with {% tree entries=$uses.groups partial="reference-node.mdoc" /%}\n- {% ask "outline" as="shape" file="src/x.ts" /%} → {total, tree}; render with {% tree entries=$shape.tree partial="symbol-node.mdoc" /%}\n- {% ask "diagnostics" as="problems" file="src/x.ts" /%} → {total, groups}; render with {% each items=$problems.groups as="group" partial="diagnostic-group.mdoc" /%}\n- {% ask "source" as="body" file="src/x.ts" from=10 to=40 /%} → {lines, startLine}; render with {% source lines=$body.lines startLine=$body.startLine /%}\n- {% ask "occurrences" as="hits" text="device.lost" file="src" /%} (file is the directory to scan) → {total, fileCount, scanned, groups}: every place the exact text occurs, or an honest zero with the scan count\n- {% ask "subject" as="what" file="src/x.ts" line=5 character=10 /%} → {name, kind, file, at}: what the position resolves to, and where it is declared\n- {% ask "callers" as="calledBy" file="src/x.ts" line=5 character=10 /%} → {name, total, projects, groups}; render with {% tree entries=$calledBy.groups partial="call-node.mdoc" /%}\n\nOne ask failing binds {failed} and is stated in a feedback line under your answer; the rest of the composition still answers.',
      inputSchema: input.Compose,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, document }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      // Markdoc attributes are untyped: a composition can bind an object where
      // a path or search text belongs, and String() would stringify it into
      // "[object Object]". Scalars pass; anything else reads as absent.
      const attributeText = (value: unknown): string =>
        typeof value === "string" || typeof value === "number" ? String(value) : "";
      const askedFile = (ask: DocumentAsk) => attributeText(ask.attributes.file);
      // Ask positions are one-based, like every position this surface accepts.
      const askedPosition = (ask: DocumentAsk) => ({
        line: Number(ask.attributes.line ?? 1) - 1,
        character: Number(ask.attributes.character ?? 1) - 1,
      });
      // The operations a composition can ask for, each binding the shape its
      // partial reads — the same shapes the dedicated tools compose from.
      const operations: Record<string, (ask: DocumentAsk) => Promise<unknown>> = {
        hover: async (ask) => {
          const { result } = await intelligence.hover({
            file: askedFile(ask),
            signal,
            params: { position: askedPosition(ask) },
          });
          return { text: markupText(result?.contents) ?? "" };
        },
        subject: async (ask) => {
          const resolved = await subjectAtPosition({
            workspace,
            uri: workspace.getWorkspaceUri(askedFile(ask)),
            position: askedPosition(ask),
            signal,
          });
          return resolved
            ? {
                name: resolved.name,
                kind: resolved.kind,
                file: displayPath(resolved.declaredAt.uri, root),
                // As text, one-based, like every position this surface
                // writes — the raw LSP object rendered as nothing, leaving
                // `file.ts:` with a dangling colon in the dossier heading.
                at: positionText(resolved.declaredAt.selection.start),
              }
            : {};
        },
        callers: async (ask) => {
          const { items, calls, projects } = await intelligence.callers({
            file: askedFile(ask),
            position: askedPosition(ask),
            signal,
          });
          const flat = (calls ?? []).flatMap((group) => group ?? []);
          const grouped = Map.groupBy(flat, (call) => displayPath(call.from.uri, root));
          return {
            name: items?.[0]?.name,
            total: flat.length,
            projects,
            groups: [...grouped].map(([file, entries]) => ({
              file,
              children: entries.map((call) => ({
                name: call.from.name,
                kind: call.from.kind,
                selection: call.from.selectionRange,
                extent: sameRange(call.from.range, call.from.selectionRange)
                  ? undefined
                  : call.from.range,
                sites: [...new Set(call.fromRanges.map((site) => rangeText(site)))],
              })),
            })),
          };
        },
        references: async (ask) => {
          const { result, projects } = await intelligence.references({
            file: askedFile(ask),
            signal,
            params: {
              position: askedPosition(ask),
              context: { includeDeclaration: false },
              scope: "workspace",
            },
          });
          const sites = [];
          for (const { uri, range } of result ?? []) {
            const chain = await declarationChainAtPosition({
              workspace,
              uri,
              position: range.start,
            }).catch(() => []);
            sites.push({
              file: displayPath(uri, root),
              line: range.start.line + 1,
              character: range.start.character + 1,
              within: enclosingDeclaration(chain, range)?.name,
            });
          }
          const ordered = [...sites].sort(
            (left, right) =>
              left.file.localeCompare(right.file) ||
              left.line - right.line ||
              left.character - right.character,
          );
          const paths = [...new Set(ordered.map(({ file }) => file))];
          return {
            total: ordered.length,
            files: paths.length,
            // The list behind the count, so a later ask can compose over it:
            // {% ask "diagnostics" files=$uses.paths /%}.
            paths,
            projects,
            groups: referenceGroups(ordered),
          };
        },
        outline: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          const parsed = documentSymbols({ uri, source }) ?? [];
          const nest = (
            entries: readonly (DocumentSymbol | SymbolInformation)[],
          ): readonly Record<string, unknown>[] =>
            entries.map((entry) => {
              const selection = "range" in entry ? entry.selectionRange : entry.location.range;
              const extent = "range" in entry ? entry.range : entry.location.range;
              return {
                name: entry.name,
                kind: entry.kind,
                selection,
                extent: sameRange(extent, selection) ? undefined : extent,
                detail: "detail" in entry ? entry.detail : undefined,
                children: "range" in entry ? nest(entry.children ?? []) : [],
              };
            });
          return { total: parsed.length, tree: nest(parsed) };
        },
        diagnostics: async (ask) => {
          // One file named directly, or the files an earlier ask answered
          // with — bounded, because each file is a whole document check.
          const named = Array.isArray(ask.attributes.files)
            ? ask.attributes.files.map(String)
            : [askedFile(ask)];
          const checked = named.slice(0, 5);
          const perFile = await Promise.all(
            checked.map(async (file) => {
              const { uri } = await workspace.getTextDocument(file);
              const report = await workspace.sendRequest(
                DocumentDiagnosticRequest.type,
                { textDocument: { uri } },
                signal,
              );
              const problems = (
                report && typeof report === "object" && "items" in report
                  ? ((report as { items: readonly Diagnostic[] }).items ?? [])
                  : []
              ).map((entry) => ({
                severity: entry.severity,
                source: entry.source,
                code: entry.code,
                range: entry.range,
                message: entry.message,
              }));
              return { file: displayPath(uri, root), problems };
            }),
          );
          return {
            total: perFile.reduce((sum, { problems }) => sum + problems.length, 0),
            groups: perFile.filter(({ problems }) => problems.length > 0),
            checked: checked.length,
            of: named.length,
          };
        },
        source: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          const lines = source.split("\n");
          const from = Number(ask.attributes.from ?? 1);
          return {
            lines: lines.slice(from - 1, Number(ask.attributes.to ?? lines.length)),
            startLine: from,
          };
        },
        occurrences: async (ask) =>
          scanOccurrences({
            root,
            text: attributeText(ask.attributes.text) || attributeText(ask.attributes.query),
            directory: askedFile(ask) || ".",
            limit: 40,
            signal,
          }),
      };
      const asks = documentAsks(document);
      const unfulfillable = asks.filter(({ operation }) => !(operation in operations));
      if (unfulfillable.length > 0) {
        throw new Error(
          `This composition asks for ${unfulfillable
            .map(({ operation }) => `"${operation}"`)
            .join(", ")}; the operations are ${Object.keys(operations).join(", ")}.`,
        );
      }
      // Asks fulfill in document order, each seeing what earlier asks bound —
      // `files=$uses.paths` reads the reference answer above it. Order is the
      // dependency rule: a reference to a later or unknown bind is an error a
      // composer can act on, not a hole.
      const bound: Record<string, unknown> = {};
      for (const ask of asks) {
        const resolved: DocumentAsk = {
          ...ask,
          attributes: Object.fromEntries(
            Object.entries(ask.attributes).map(([name, value]) => {
              if (!isAskReference(value)) return [name, value];
              const [head, ...rest] = value.reference;
              if (head === undefined || !(head in bound)) {
                throw new Error(
                  `${ask.operation} reads $${value.reference.join(".")}, but only ${
                    Object.keys(bound).join(", ") || "nothing"
                  } is bound above it — an ask reads earlier asks only.`,
                );
              }
              return [
                name,
                rest.reduce<unknown>(
                  (held, step) => (held as Record<string, unknown> | undefined)?.[step],
                  bound[head],
                ),
              ];
            }),
          ),
        };
        // One ask's failure is that ask's sentence, never the composition's:
        // a dossier missing one section it names honestly beats no dossier.
        bound[ask.bind] = await operations[ask.operation]!(resolved).catch((cause: unknown) => ({
          failed: cause instanceof Error ? cause.message : String(cause),
        }));
      }
      // The agent is the author. The document is the whole answer: asks
      // declare data and render nothing, the body composes what they bind,
      // and nothing here writes markup on the composer's behalf — a
      // server-synthesized section was the premise inverted.
      const rendered = await renderComposition({ source: document, variables: bound });
      // Feedback, not authored content: a bind root the body reads that no
      // ask declared is a typo (absent FIELDS under a real bind are the
      // documented empty-case idiom and stay silent), and a failed ask is
      // stated so its silence in the body is never mistaken for absence.
      const binds = new Set(asks.map(({ bind }) => bind));
      const unknownRoots = [...new Set(rendered.undefinedVariables)].filter(
        (name) => !binds.has(name.split(".")[0] ?? name),
      );
      const failures = asks.filter((ask) => {
        const held = bound[ask.bind] as { failed?: string } | undefined;
        return held?.failed !== undefined;
      });
      const feedback = [
        ...(unknownRoots.length > 0
          ? [
              `Undefined in this composition: ${unknownRoots.join(", ")} — the asks bind ${
                asks.map(({ bind }) => bind).join(", ") || "nothing"
              }.`,
            ]
          : []),
        ...failures.map(
          (ask) =>
            `The ${ask.operation} ask binding ${ask.bind} failed: ${
              (bound[ask.bind] as { failed: string }).failed
            }`,
        ),
      ];
      return textResult(
        feedback.length > 0 ? `${rendered.text}\n\n${feedback.join("\n")}` : rendered.text,
      );
    },
  );

  registerTool(
    server,
    "impact",
    {
      title: "Impact",
      description:
        "Experimental: weigh a change to the symbol at a position — every use, grouped by package, with how many sit in tests. Loads the projects of consumers retrieval can see, so the answer reaches past what this session happened to touch. Composed for the decision, not the enumeration; references lists the sites themselves.",
      inputSchema: input.Impact,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      // The one subject owner: the resolved name is right even when the
      // asked position is a use site, where the enclosing-declaration walk
      // answered the wrong thing.
      const declaration = await subjectAtPosition({
        workspace,
        uri: workspace.getWorkspaceUri(file),
        position,
        signal,
      }).catch(() => undefined);
      // A decision needs the whole blast radius, and the reference fan-out
      // reaches only projects something already loaded. Retrieval sees the
      // name across the entire repository, so packages it names that no
      // loaded project covers get loaded first — project selection for one
      // of their files is the load — bounded to a handful so one question
      // cannot demand every project in a monorepo.
      const consumerBudget = 4;
      const candidates = declaration?.name
        ? await semble
            .search({ repo: root, query: declaration.name, limit: 20, snippetLines: 0, signal })
            .then(({ results }) =>
              [
                ...new Set(
                  results
                    .map(({ file_path }) => packageOf(file_path))
                    .filter(
                      (name) =>
                        name !== packageOf(displayPath(workspace.getWorkspaceUri(file), root)),
                    ),
                ),
              ].slice(0, consumerBudget),
            )
            .catch(() => [])
        : [];
      const loaded = await Promise.all(
        candidates.map((name) =>
          semble
            .search({
              repo: root,
              query: `${declaration?.name ?? ""} ${name}`,
              limit: 3,
              snippetLines: 0,
              signal,
            })
            .then(async ({ results }) => {
              const inside = results.find(({ file_path }) => packageOf(file_path) === name);
              if (!inside) return undefined;
              await workspace.sendRequest(
                GetMatchTsConfigRequest.type,
                { uri: workspace.getWorkspaceUri(inside.file_path) },
                signal,
              );
              return name;
            })
            .catch(() => undefined),
        ),
      );
      const { result: references } = await intelligence.references({
        file,
        signal,
        params: { position, context: { includeDeclaration: false }, scope: "workspace" },
      });
      const sites = (references ?? []).map(({ uri }) => displayPath(uri, root));
      const explored = new Set(loaded.filter((name) => name !== undefined));
      const byPackage = Map.groupBy(sites, packageOf);
      const rows = [...byPackage]
        .map(([name, held]) => ({
          name,
          uses: held.length,
          files: new Set(held).size,
          tests: held.filter(isTestSite).length,
        }))
        .sort((left, right) => right.uses - left.uses);
      const rendered = await renderDocument({
        document: "impact.tool.mdoc",
        variables: {
          subject: declaration?.name ?? "the symbol at this position",
          answered: references !== null,
          total: sites.length,
          fileCount: new Set(sites).size,
          packageCount: rows.length,
          testCount: rows.reduce((total, { tests }) => total + tests, 0),
          // Named by retrieval, not loaded or not confirming a use — the
          // characterised remainder a decision still has to weigh.
          beyond: candidates.filter(
            (name) => !explored.has(name) && !rows.some((row) => row.name === name),
          ),
          // Two bare numeric columns read as a riddle — a user weighed "4 3"
          // without knowing which was files. The component has always taken
          // headings; impact just never passed them.
          columns: [
            { heading: "package" },
            { heading: "uses", align: "end" },
            { heading: "files", align: "end" },
            { heading: "tests", align: "end" },
          ],
          rows: rows.map(({ name, uses, files, tests }) => [
            name,
            String(uses),
            String(files),
            tests ? String(tests) : "",
          ]),
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "occurrences",
    {
      title: "Occurrences",
      description:
        'Experimental: every place an exact text occurs under a directory, with an honest zero — the literal proof of absence a semantic search cannot give. Scans workspace files (gitignore honored, dependencies excluded); use it for teardown checks, string keys, config references, and "is this token ever used" questions. search_code finds meaning; this finds bytes.',
      inputSchema: input.Occurrences,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, text, directory = ".", limit = 40 }, { mcpReq: { signal } }) => {
      const rendered = await renderDocument({
        document: "occurrences.tool.mdoc",
        variables: await scanOccurrences({ root, text, directory, limit, signal }),
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "quorl",
    {
      title: "Quorl",
      description:
        "Expand the transitive reference closure of a symbol, breadth-first, reporting every site with its source line and the declaration enclosing it, plus the frontier that was not expanded. Use before removing or replacing something, when you need the whole blast radius rather than one hop.",
      inputSchema: input.Quorl,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace, file, position, depth = 2, limit = 40 }, { mcpReq: { signal } }) =>
      textResult(await quorl({ workspace, file, position, depth, limit, signal })),
  );
};
