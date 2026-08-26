import type { McpServer } from "@modelcontextprotocol/server";
import {
  type CallHierarchyItem,
  type Diagnostic,
  type DocumentSymbol,
  DocumentDiagnosticRequest,
  type Location,
  type LocationLink,
  type Range,
  type SymbolInformation,
  GetMatchTsConfigRequest,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationChainAtPosition,
  declarationsNamed,
  documentSymbols,
  foldValueSymbols,
  projectDocumentSymbols,
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
import { isDependency } from "./inspection-variables.ts";
import { createRetrievalIntelligence } from "./intelligence.ts";
import { semanticOccurrences } from "./occurrences.tool.ts";
import type { Semble } from "./semble.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
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

export const registerExperimentalTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const quorl = createQuorl({ workspaces });
  const retrieval = createRetrievalIntelligence({ semble, workspaces });

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
        'Answer several questions about code in one call, laid out how you want. `{% ask %}` tags declare data and render nothing; the body you write is the whole answer.\n\nEach ask is named for the tool that answers it and answers as that tool does. Point one at a declaration by name with `symbol="foo"`, or at `line`/`character` (one-based). Every ask also binds `.text`, already rendered, so the shortest useful composition is two lines and needs nothing memorised:\n\n{% ask "references" as="uses" file="src/x.ts" symbol="foo" /%}\n{% $uses.text %}\n\nAsks, and the fields each binds besides `.text`:\n- hover → {text}: signature and documentation\n- subject → {name, kind, file, at}: what a position resolves to\n- references → {total, files, paths, projects, groups}; also takes `tests="only"` or `tests="exclude"` to narrow the uses it already found — "which tests cover this" against "what breaks if I change it". That split is a path heuristic (a `tests/` directory, a `.test.`/`.spec.` name), not something the compiler knows\n- definitions | type_definitions | implementations → {total, files, paths, groups}\n- callers | callees → {name, total, groups, dependencies}; calls into dependencies are named in `dependencies` rather than listed as rows\n- document_symbols → {total, tree}; `depth` opens nested levels, `raw` keeps everything\n- diagnostics → {total, groups, checked, of}; takes `file`, or `files=$uses.paths` from an earlier ask\n- read_file → {lines, startLine}; `from` and `to`\n- occurrences → {text, …}: exact identifiers resolved to their references, with an honest zero when a name occurs nowhere; takes `query`, and `path`, `limit`, `symbolLimit`\n- search_code → {text}: find code by what it does when the name is unknown, each hit anchored to a language-server symbol; takes `query`, and `directory`, `limit`, `snippetLines`\n- workspace_symbols → {total, projects, hits, file, line, character}: find a declaration by `query` across loaded projects, where `file` only picks which project to search from. Binds the first hit\'s location, so the next ask can point at it: `file=$found.file line=$found.line character=$found.character`\n\nTo guard a section, use the boolean: `{% if $uses.any %}` on its own line, with the heading and body under it. A count does not work — `{% if $uses.total %}` renders on zero, because the engine asks whether the value is there, not whether it is nonzero. Every countable ask binds `any`.\n\n`paths` is a list to hand to another ask, not text to print — interpolating it runs the paths together. The file list is already in `.text`.\n\nFor a layout of your own, use the fields with the shipped tags: {% tree entries=$uses.groups partial="reference-node.mdoc" /%}, {% tree entries=$calledBy.groups partial="call-node.mdoc" /%}, {% tree entries=$shape.tree partial="symbol-node.mdoc" /%}, {% each items=$problems.groups as="group" partial="diagnostic-group.mdoc" /%}, {% source lines=$body.lines startLine=$body.startLine /%}.\n\nAsks fulfil in document order and a later one may read an earlier bind. A failing ask is named in a line under the answer; the rest still render.',
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
      // Where an ask points: a name in the file, or a one-based position.
      // Naming the symbol is the ergonomic form — a composer that had to supply
      // line and character first ran another tool to find them, which is the
      // round trip a composition exists to remove.
      const askedPosition = async (ask: DocumentAsk) => {
        const symbol = attributeText(ask.attributes.symbol);
        if (!symbol) {
          return {
            line: Number(ask.attributes.line ?? 1) - 1,
            character: Number(ask.attributes.character ?? 1) - 1,
          };
        }
        const uri = workspace.getWorkspaceUri(askedFile(ask));
        const { source } = await workspace.readTextDocumentUri(uri, signal);
        const matches = declarationsNamed(documentSymbols({ uri, source }) ?? [], uri, symbol);
        const only = matches.length === 1 ? matches[0] : undefined;
        if (!only) {
          throw new Error(
            matches.length === 0
              ? `${askedFile(ask)} declares no "${symbol}".`
              : `${askedFile(ask)} declares "${symbol}" ${String(matches.length)} times; ask by line and character instead.`,
          );
        }
        return only.selectionRange.start;
      };
      // An ask renders its own text through the same partial an author would
      // reach for, so the two forms cannot drift: `{% $uses.text %}` and the
      // hand-written tree produce the same lines.
      const asText = async (source: string, variables: Record<string, unknown>) =>
        (await renderComposition({ source, variables })).text;
      // A dedicated tool's own document, so an ask that stands in for a tool
      // answers exactly as that tool does — scope disclosures included.
      const asDocument = async (document: string, variables: Record<string, unknown>) =>
        (await renderDocument({ document, variables })).text;
      // Every ask that answers with places binds this one shape, so a composer
      // learns it once: references, definitions, types, and implementations all
      // render through `reference-node.mdoc`.
      // Narrowing what an ask already fetched, the way a shell pipeline
      // narrows a result set — but over a fact the surface knows rather than
      // text. `tests="only"` reads as "which tests cover this", `"exclude"` as
      // "what actually breaks if I change it", and a symbol with sixty uses is
      // unreadable without one of them.
      const testFilter = (ask: DocumentAsk) => {
        const wanted = attributeText(ask.attributes.tests);
        return (file: string) =>
          wanted === "only" ? isTestSite(file) : wanted === "exclude" ? !isTestSite(file) : true;
      };
      const places = async (
        locations: readonly { uri: string; range: Range }[],
        keep: (file: string) => boolean = () => true,
      ) => {
        const sites = [];
        for (const { uri, range } of locations) {
          if (!keep(displayPath(uri, root))) continue;
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
        const groups = referenceGroups(ordered);
        return {
          total: ordered.length,
          // A count cannot guard a section: `{% if $uses.total %}` renders on
          // zero, because the engine asks whether the value is there rather
          // than whether it is nonzero. Every countable ask binds this so a
          // composer can write `{% if $uses.any %}` and mean it.
          any: ordered.length > 0,
          files: paths.length,
          // The list behind the count, so a later ask can compose over it:
          // {% ask "diagnostics" files=$uses.paths /%}.
          paths,
          groups,
          // Rendered here so the shortest useful composition is `{% $uses.text %}`
          // — a composer who wants their own layout still has the fields, but
          // nobody has to learn a partial's filename to get an answer out.
          text: await asText('{% tree entries=$groups partial="reference-node.mdoc" /%}', {
            groups,
          }),
        };
      };
      // Both directions of the call graph render the same rows; only which end
      // of each call they name differs.
      const callSites = async (
        all: readonly { item: CallHierarchyItem; sites: readonly Range[] }[],
      ) => {
        // A call into a dependency is named, not located: `registerDocumentTools`
        // answered with 43 rows, most of them `map` and `then` pointing into
        // `lib.es5.d.ts`, burying the three calls a reader could act on.
        const entries = all.filter(({ item }) => !isDependency(item.uri, root));
        const dependencies = [
          ...new Set(all.filter(({ item }) => isDependency(item.uri, root)).map(({ item }) => item.name)),
        ];
        const groups = [
          ...Map.groupBy(entries, ({ item }) => displayPath(item.uri, root)),
        ].map(([file, rows]) => ({
          file,
          children: rows.map(({ item, sites }) => ({
            name: item.name,
            kind: item.kind,
            selection: item.selectionRange,
            extent: sameRange(item.range, item.selectionRange) ? undefined : item.range,
            sites: [...new Set(sites.map((site) => rangeText(site)))],
          })),
        }));
        return {
          total: entries.length,
          any: entries.length > 0,
          groups,
          dependencies,
          text: await asText('{% tree entries=$groups partial="call-node.mdoc" /%}', { groups }),
        };
      };
      // The operations a composition can ask for, each binding the shape its
      // partial reads — the same shapes the dedicated tools compose from.
      const operations: Record<string, (ask: DocumentAsk) => Promise<unknown>> = {
        hover: async (ask) => {
          const { result } = await intelligence.hover({
            file: askedFile(ask),
            signal,
            params: { position: await askedPosition(ask) },
          });
          return { text: markupText(result?.contents) ?? "" };
        },
        subject: async (ask) => {
          const resolved = await subjectAtPosition({
            workspace,
            uri: workspace.getWorkspaceUri(askedFile(ask)),
            position: await askedPosition(ask),
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
            position: await askedPosition(ask),
            signal,
          });
          const flat = (calls ?? []).flatMap((group) => group ?? []);
          return {
            name: items?.[0]?.name,
            projects,
            ...(await callSites(
              flat.map((call) => ({ item: call.from, sites: call.fromRanges })),
            )),
          };
        },
        callees: async (ask) => {
          const { items, calls } = await intelligence.callees({
            file: askedFile(ask),
            position: await askedPosition(ask),
            signal,
          });
          const flat = (calls ?? []).flatMap((group) => group ?? []);
          return {
            name: items?.[0]?.name,
            ...(await callSites(flat.map((call) => ({ item: call.to, sites: call.fromRanges })))),
          };
        },
        references: async (ask) => {
          const position = await askedPosition(ask);
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { result, projects } = await intelligence.references({
            file: askedFile(ask),
            signal,
            params: { position, context: { includeDeclaration: false }, scope: "workspace" },
          });
          // Which tsconfig answered, because "widen this search" means opening
          // a file in a project this one did not cover.
          const matched = (await workspace
            .sendRequest(GetMatchTsConfigRequest.type, { uri }, signal)
            .catch(() => undefined)) as { uri?: string } | undefined;
          const resolved = await subjectAtPosition({ workspace, uri, position, signal }).catch(
            () => undefined,
          );
          // The declaration is not a use of itself. `includeDeclaration: false`
          // asks the server to leave it out and the server returns it anyway,
          // which reported one more reference than the `references` tool for
          // the same symbol.
          const declaredAt = resolved?.declaredAt;
          const found = await places(
            (result ?? []).filter(
              (site) =>
                !declaredAt ||
                site.uri !== declaredAt.uri ||
                site.range.start.line !== declaredAt.selection.start.line ||
                site.range.start.character !== declaredAt.selection.start.character,
            ),
            testFilter(ask),
          );
          // Rendered through the `references` tool's own document, so composing
          // is never less honest than calling it. A reference count without the
          // scope it covered reads as complete when it is not — and the tree
          // alone said "3 uses" for a symbol whose other users live in a
          // project this session had not loaded.
          return {
            ...found,
            projects,
            text: await asDocument("references.tool.mdoc", {
              subject: resolved?.name,
              kind: resolved?.kind,
              found: resolved !== undefined || found.total > 0,
              declaredAt: resolved
                ? { file: displayPath(resolved.declaredAt.uri, root), at: positionText(resolved.declaredAt.selection.start) }
                : undefined,
              everyProject: true,
              projects,
              anchor: matched?.uri ? displayPath(matched.uri, root) : undefined,
              total: found.total,
              noUses: found.total === 0,
              groups: found.groups,
            }),
          };
        },
        // Whether a dossier wants literal proof is the composer's call, not
        // this tool's. Answers as `occurrences` does, through its own document.
        occurrences: async (ask) => {
          const result = await semanticOccurrences({
            root,
            workspace,
            queries: [attributeText(ask.attributes.query)],
            paths: [attributeText(ask.attributes.path) || "."],
            symbolLimit: Number(ask.attributes.symbolLimit ?? 5),
            offset: 0,
            limit: Number(ask.attributes.limit ?? 20),
            signal,
          });
          return { ...result, text: await asDocument("occurrences.tool.mdoc", result) };
        },
        // Find code by what it does, for when the name is unknown — the other
        // half of orientation, where `symbols` needs a name to search for.
        search_code: async (ask) => ({
          text: await retrieval.search({
            root,
            directory: attributeText(ask.attributes.directory) || undefined,
            includeTypes: false,
            query: attributeText(ask.attributes.query),
            limit: Number(ask.attributes.limit ?? 5),
            snippetLines: Number(ask.attributes.snippetLines ?? 10),
            signal,
          }),
        }),
        // Find a declaration by name before anything can be asked about it.
        // Without this a composition could only ever explain a symbol whose
        // file the composer already knew, so orientation stayed a separate
        // call and the first move in an unfamiliar repository was never
        // composable. Binds `file`, `line`, and `character` of the first hit,
        // so a later ask can point at it: file=$found.file line=$found.line.
        workspace_symbols: async (ask) => {
          const { symbols, projects } = await intelligence.workspaceSymbols({
            file: askedFile(ask),
            query: attributeText(ask.attributes.query),
            signal,
          });
          const hits = (symbols ?? []).map((symbol) => ({
            name: symbol.name,
            kind: symbol.kind,
            word: "word" in symbol ? (symbol as { word?: string }).word : undefined,
            file: displayPath(symbol.location.uri, root),
            range: symbol.location.range,
            container: symbol.containerName || undefined,
            line: symbol.location.range.start.line + 1,
            character: symbol.location.range.start.character + 1,
          }));
          const [first] = hits;
          return {
            total: hits.length,
            any: hits.length > 0,
            projects,
            file: first?.file,
            line: first?.line,
            character: first?.character,
            hits,
            text: await asText('{% each items=$hits as="item" partial="workspace-symbol.mdoc" /%}', {
              hits,
            }),
          };
        },
        document_symbols: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          // Folded and depth-limited exactly like `document_symbols`: an
          // outline that prints every local and callback answers a question
          // nobody asked — this file alone rendered 14 declarations as 90
          // rows. `depth` opens it a level at a time; `raw=true` keeps
          // everything.
          const raw = ask.attributes.raw === true;
          const folded = (documentSymbols({ uri, source }) ?? []).map((entry) =>
            raw ? entry : foldValueSymbols(entry),
          );
          const parsed = raw
            ? folded
            : projectDocumentSymbols([...folded], Number(ask.attributes.depth ?? 0));
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
                // What folding collapsed, so a folded row still prices itself
                // — `· 4 entries` rather than a row that looks childless.
                folded: (entry as { readonly folded?: number }).folded,
                children: "range" in entry ? nest(entry.children ?? []) : [],
              };
            });
          const tree = nest(parsed);
          return {
            total: parsed.length,
            tree,
            text: await asText('{% tree entries=$tree partial="symbol-node.mdoc" /%}', { tree }),
          };
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
          const groups = perFile.filter(({ problems }) => problems.length > 0);
          const total = perFile.reduce((sum, { problems }) => sum + problems.length, 0);
          return {
            total,
            any: total > 0,
            groups,
            checked: checked.length,
            of: named.length,
            text: await asText(
              '{% each items=$groups as="group" partial="diagnostic-group.mdoc" /%}',
              { groups },
            ),
          };
        },
        // Definitions, types, and implementations answer the same shape — a
        // list of places — so they share one binding rather than three that
        // differ only in which request they send.
        ...Object.fromEntries(
          (
            [
              ["definitions", intelligence.definitions],
              ["type_definitions", intelligence.typeDefinitions],
              ["implementations", intelligence.implementations],
            ] as const
          ).map(([name, request]) => [
            name,
            async (ask: DocumentAsk) => {
              const { result } = await request({
                file: askedFile(ask),
                signal,
                params: { position: await askedPosition(ask) },
              });
              return await places(
                (Array.isArray(result) ? result : result ? [result] : []).map(
                  (entry: Location | LocationLink) =>
                    "targetUri" in entry
                      ? { uri: entry.targetUri, range: entry.targetSelectionRange }
                      : { uri: entry.uri, range: entry.range },
                ),
              );
            },
          ]),
        ),
        read_file: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          const all = source.split("\n");
          const from = Number(ask.attributes.from ?? 1);
          const lines = all.slice(from - 1, Number(ask.attributes.to ?? all.length));
          return {
            lines,
            startLine: from,
            text: await asText("{% source lines=$lines startLine=$startLine /%}", {
              lines,
              startLine: from,
            }),
          };
        },
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
        "Experimental: weigh a change to the symbol at a position — uses in loaded projects, grouped by package, with how many sit in tests. Composed for the decision, not the enumeration; references lists the sites themselves.",
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
      const { result: references } = await intelligence.references({
        file,
        signal,
        params: { position, context: { includeDeclaration: false }, scope: "workspace" },
      });
      const sites = (references ?? []).map(({ uri }) => displayPath(uri, root));
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
