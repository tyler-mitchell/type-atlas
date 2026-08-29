import type { McpServer } from "@modelcontextprotocol/server";
import {
  type Diagnostic,
  type DocumentSymbol,
  DocumentDiagnosticRequest,
  type Range,
  type SymbolInformation,
  GetMatchTsConfigRequest,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationAtPosition,
  declarationChainAtPosition,
  declarationsNamed,
  documentSymbols,
  foldValueSymbols,
  inspectSymbol,
  projectDocumentSymbols,
  renderComposition,
  renderDocument,
  subjectAtPosition,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type } from "arktype";
import { displayPath, markupText, positionText, sameRange } from "@type-atlas/atlascii";
import { type DocumentAsk, documentAsks, isAskReference } from "@type-atlas/atlascii/document";
import { composeDescription } from "./compose.description.ts";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { createQuorl } from "./quorl.ts";
import { callHierarchyVariables, inspectionVariables } from "./inspection-variables.ts";
import { navigationTargets } from "./navigation-targets.ts";
import { createRetrievalIntelligence } from "./intelligence.ts";
import { semanticOccurrences } from "./occurrences.tool.ts";
import type { Semble } from "./semble.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
import { registerTool } from "./tool.ts";
import { fileInput, positionInput } from "./tool-input.ts";
import { workspaceTree } from "./workspace-tree.ts";

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
  Compose: type({
    workspace: fileInput.workspace,
    document: type("string >= 1").configure({
      description: "Markdoc source: ask declarations followed by a body composing what they bind.",
    }),
  }),
});

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
    "compose",
    {
      title: "Compose",
      description: composeDescription,
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
      // A cut list that says nothing about the cut reads as the whole answer.
      const withRest = (text: string, beyond: number, limit: number) =>
        beyond > 0 ? `${text}\n\n… ${String(beyond)} more, past limit ${String(limit)}.` : text;
      const places = async (
        locations: readonly { uri: string; range: Range }[],
        ask: DocumentAsk,
      ) => {
        const keep = testFilter(ask);
        const kept = locations.filter(({ uri }) => keep(displayPath(uri, root)));
        // Bounded, and concurrent inside the bound. Naming the declaration
        // that holds each site costs a language-server round trip, and these
        // ran one after another over everything found — a symbol with five
        // hundred uses was five hundred serial requests for one answer.
        const limit = Number(ask.attributes.limit ?? 50);
        const sites = await Promise.all(
          kept.slice(0, limit).map(async ({ uri, range }) => {
            const chain = await declarationChainAtPosition({
              workspace,
              uri,
              position: range.start,
            }).catch(() => []);
            return {
              file: displayPath(uri, root),
              line: range.start.line + 1,
              character: range.start.character + 1,
              within: enclosingDeclaration(chain, range)?.name,
            };
          }),
        );
        const ordered = [...sites].sort(
          (left, right) =>
            left.file.localeCompare(right.file) ||
            left.line - right.line ||
            left.character - right.character,
        );
        // Over everything kept, not only what is listed: this is the list a
        // later ask reads, and a file holding a use past the bound still
        // holds one.
        const paths = [...new Set(kept.map(({ uri }) => displayPath(uri, root)))];
        const groups = referenceGroups(ordered);
        const beyond = kept.length - ordered.length;
        return {
          beyond,
          limit,
          shown: ordered.length,
          total: kept.length,
          // A count cannot guard a section: `{% if $uses.total %}` renders on
          // zero, because the engine asks whether the value is there rather
          // than whether it is nonzero. Every countable ask binds this so a
          // composer can write `{% if $uses.any %}` and mean it.
          any: kept.length > 0,
          files: paths.length,
          // The list behind the count, so a later ask can compose over it:
          // {% ask "diagnostics" files=$uses.paths /%}.
          paths,
          groups,
          // Rendered here so the shortest useful composition is `{% $uses.text %}`
          // — a composer who wants their own layout still has the fields, but
          // nobody has to learn a partial's filename to get an answer out.
          text: withRest(
            await asText('{% tree entries=$groups partial="reference-node.mdoc" /%}', { groups }),
            beyond,
            limit,
          ),
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
          if (!resolved) return { text: "Nothing to report." };
          const file = displayPath(resolved.declaredAt.uri, root);
          const at = positionText(resolved.declaredAt.selection.start);
          return {
            name: resolved.name,
            kind: resolved.kind,
            file,
            at,
            text: await asText("{% $name %} · {% $location %}", {
              name: resolved.name,
              location: `${file}:${at}`,
            }),
          };
        },
        inspect_symbol: async (ask) => {
          const result = await inspectSymbol({
            workspace,
            root,
            file: askedFile(ask),
            // Always a position, because compose resolves `symbol=` itself and
            // reports ambiguity in its own words — two resolvers for one job
            // would answer the same question differently.
            target: { position: await askedPosition(ask) },
            options: {
              compactExternalCalls: true,
              scope: "workspace",
              includeSource: ask.attributes.includeSource === true,
              // Off, as the tool itself decides it. Forcing it on answered a
              // local `readonly DocumentSymbol[]` with eleven rows of
              // ReadonlyArray from lib.es5.d.ts — the built-in type of a
              // variable is almost never the question, and it buried the
              // dossier that was.
              includeTypeDefinitions: ask.attributes.includeTypeDefinitions === true,
              limit: Number(ask.attributes.limit ?? 20),
            },
            signal,
          });
          const variables = inspectionVariables({ result, root });
          return { ...variables, text: await asDocument("inspect-symbol.tool.mdoc", variables) };
        },
        // Both directions answer through their own tool documents, which is
        // where the two facts a bare tree left out live: a call hierarchy is
        // bounded to the project owning the file, and `displayPath` reported
        // thirteen callers — every one of them a test in its own package —
        // with nothing saying the rest of the repository was never searched.
        // The library calls it folds to one line also come back; a composer
        // printing `dependencies` got an empty string, because a list is not
        // text.
        callers: async (ask) => {
          const { items, calls, projects } = await intelligence.callers({
            file: askedFile(ask),
            position: await askedPosition(ask),
            signal,
          });
          const variables = {
            ...callHierarchyVariables({ items, calls, root, callable: (call) => call.from }),
            projects,
          };
          return {
            ...variables,
            any: variables.total > 0,
            text: await asDocument("callers.tool.mdoc", variables),
          };
        },
        callees: async (ask) => {
          const { items, calls } = await intelligence.callees({
            file: askedFile(ask),
            position: await askedPosition(ask),
            signal,
          });
          const variables = callHierarchyVariables({
            items,
            calls,
            root,
            callable: (call) => call.to,
          });
          return {
            ...variables,
            any: variables.total > 0,
            text: await asDocument("callees.tool.mdoc", variables),
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
            ask,
          );
          // Rendered through the `references` tool's own document, so composing
          // is never less honest than calling it. A reference count without the
          // scope it covered reads as complete when it is not — and the tree
          // alone said "3 uses" for a symbol whose other users live in a
          // project this session had not loaded.
          return {
            ...found,
            projects,
            // The document renders the sites it was given and states the
            // scope it covered; it cannot know a bound cut the list first.
            text: withRest(
              await asDocument("references.tool.mdoc", {
                subject: resolved?.name,
                kind: resolved?.kind,
                found: resolved !== undefined || found.total > 0,
                declaredAt: resolved
                  ? {
                      file: displayPath(resolved.declaredAt.uri, root),
                      at: positionText(resolved.declaredAt.selection.start),
                    }
                  : undefined,
                everyProject: true,
                projects,
                anchor: matched?.uri ? displayPath(matched.uri, root) : undefined,
                total: found.total,
                noUses: found.total === 0,
                groups: found.groups,
              }),
              found.beyond,
              found.limit,
            ),
          };
        },
        // Who imports this module, which is not what any symbol's references
        // answer: a barrel re-exporting everything has importers and no uses
        // of its own, and "what depends on this file" is the question asked
        // before moving or deleting one.
        file_references: async (ask) => {
          const file = askedFile(ask);
          const uri = workspace.getWorkspaceUri(file);
          const { result, projects } = await intelligence.fileReferences({ file, signal });
          const found = await places(result ?? [], ask);
          // Which tsconfig answered. "Nothing imports this" is a decision to
          // move or delete a file, and it is only as true as the reach behind
          // it — a bare list of importers states no reach at all.
          const matched = (await workspace
            .sendRequest(GetMatchTsConfigRequest.type, { uri }, signal)
            .catch(() => undefined)) as { uri?: string } | undefined;
          return {
            ...found,
            projects,
            text: withRest(
              await asDocument("file-references.tool.mdoc", {
                file: displayPath(uri, root),
                anchor: matched?.uri ? displayPath(matched.uri, root) : undefined,
                projects,
                total: found.total,
                groups: found.groups,
              }),
              found.beyond,
              found.limit,
            ),
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
          // Every name the search resolved, flattened into places. The
          // answer nests declarations under the query that found them, which
          // reads well and composes badly: an exact-name search is the other
          // way in when you know what something is called, and it ended
          // where `search_code` used to — rendering prose, pointing nowhere.
          const subjects = result.queries.flatMap((query) =>
            query.subjects.map(({ name, kind, file, line, character }) => ({
              name,
              kind,
              file,
              line,
              character,
            })),
          );
          return {
            ...result,
            subjects,
            total: subjects.length,
            any: subjects.length > 0,
            text: await asDocument("occurrences.tool.mdoc", result),
          };
        },
        // The first move in an unfamiliar repository, and the one thing a
        // composition could not do: every other ask needs a path the composer
        // already has. Orientation stayed outside compose, so the first call
        // was always a plain listing and the composition began at call two.
        // Binds `files` as well as the tree, so a listing can feed a fan-out
        // — `each=$tree.files` reads every file it found.
        list_files: async (ask) => {
          const glob = Array.isArray(ask.attributes.glob)
            ? ask.attributes.glob.map(String)
            : undefined;
          const listing = await workspaceTree({
            workspace: root,
            directory: attributeText(ask.attributes.directory) || ".",
            // A glob is already a narrowing, so it walks deep; a bare listing
            // opens one level, exactly as `list_files` decides it.
            depth: Number(ask.attributes.depth ?? (glob ? 10 : 1)),
            glob,
            includeHidden: false,
            includeIgnored: false,
            includeSubmodules: false,
            limit: Number(ask.attributes.limit ?? 500),
            loc: true,
            git: true,
            changed: ask.attributes.changed === true,
            signal,
          });
          return {
            ...listing,
            total: listing.files.length,
            any: listing.files.length > 0,
            text: await asDocument("list-files.tool.mdoc", listing),
          };
        },
        // Find code by what it does, for when the name is unknown — the other
        // half of orientation, where `symbols` needs a name to search for.
        search_code: async (ask) => {
          const { text, matches } = await retrieval.search({
            root,
            directory: attributeText(ask.attributes.directory) || undefined,
            includeTypes: false,
            query: attributeText(ask.attributes.query),
            limit: Number(ask.attributes.limit ?? 5),
            snippetLines: Number(ask.attributes.snippetLines ?? 10),
            signal,
          });
          // The entry point when no name is known was a dead end: it rendered
          // prose and bound nothing to point at, so a composition that found
          // the right code by meaning still could not ask anything about it.
          // Every hit the search anchored to a real declaration becomes a
          // place, in the shape the position asks already read.
          const hits = matches.flatMap((match) => {
            // The declaration the snippet shows, exactly as the page labels
            // it. Anchoring on the matched chunk instead named the enclosing
            // declaration — a hit on `warmProject` bound the position of the
            // function containing it, so the next ask asked about the wrong
            // symbol while the page said the right one.
            const at = match.shown ?? match.selected;
            return at === undefined
              ? []
              : [
                  {
                    name: at.symbol.name,
                    kind: at.symbol.kind,
                    file: match.displayFile,
                    line: at.selection.start.line + 1,
                    character: at.selection.start.character + 1,
                  },
                ];
          });
          const [first] = hits;
          return {
            total: hits.length,
            any: hits.length > 0,
            // What the search returned, against what it could anchor: a hit
            // landing in import statements has no declaration to ask about,
            // and a silent drop would read as the search finding less.
            of: matches.length,
            hits,
            file: first?.file,
            line: first?.line,
            character: first?.character,
            text,
          };
        },
        // Find a declaration by name before anything can be asked about it.
        // Without this a composition could only ever explain a symbol whose
        // file the composer already knew, so orientation stayed a separate
        // call and the first move in an unfamiliar repository was never
        // composable. Binds `file`, `line`, and `character` of the first hit,
        // so a later ask can point at it: file=$found.file line=$found.line.
        workspace_symbols: async (ask) => {
          const query = attributeText(ask.attributes.query);
          const { project, projects, symbols } = await intelligence.workspaceSymbols({
            file: askedFile(ask),
            query,
            signal,
          });
          const limit = Number(ask.attributes.limit ?? 20);
          const all = (symbols ?? []).map((symbol) => {
            const range =
              "range" in symbol.location && symbol.location.range
                ? symbol.location.range
                : undefined;
            return {
              name: symbol.name,
              kind: symbol.kind,
              // TypeScript's own word when the server carried it — the number
              // cannot say "type".
              word: "word" in symbol ? (symbol as { word?: string }).word : undefined,
              file: displayPath(symbol.location.uri, root),
              range,
              container: symbol.containerName || undefined,
              line: (range?.start.line ?? 0) + 1,
              character: (range?.start.character ?? 0) + 1,
            };
          });
          const hits = all.slice(0, limit);
          const [first] = hits;
          return {
            total: all.length,
            shown: hits.length,
            any: all.length > 0,
            // A provider that did not answer and one that searched and found
            // nothing both arrive as zero and mean opposite things — the
            // second says the name is absent, the first says nothing at all.
            // Collapsing them is how a cold session reports an empty
            // workspace as fact.
            answered: symbols !== null,
            projects,
            file: first?.file,
            line: first?.line,
            character: first?.character,
            hits,
            text: withRest(
              await asDocument("workspace-symbols.tool.mdoc", {
                query,
                anchor: project ? displayPath(project.uri, root) : undefined,
                answered: symbols !== null,
                projects,
                total: all.length,
                items: hits,
              }),
              all.length - hits.length,
              limit,
            ),
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
          // Paths or places, the same rule `each` reads items by. `files=$found.hits`
          // is the obvious thing to write when a search just answered, and it
          // stringified every place to "[object Object]", then reported that back
          // as a percent-encoded URI that named nothing a composer could act on.
          const named = [
            ...new Set(
              Array.isArray(ask.attributes.files)
                ? ask.attributes.files.map((item) =>
                    typeof item === "object" && item !== null
                      ? String((item as { readonly file?: unknown }).file ?? "")
                      : String(item),
                  )
                : [askedFile(ask)],
            ),
          ].filter(Boolean);
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
              {
                name: "definitions",
                request: intelligence.definitions,
                document: "definitions.tool.mdoc",
                // The implementation request answers with the declaration
                // itself for anything nothing overrides, so a lone target
                // covering the asked position means none — counting it would
                // report every plain function as implementing itself.
                fromOrigin: false,
                // Where the answer's subject is a target's own identifier
                // rather than the symbol asked about. A type definition's
                // subject is the value you asked about, not the type it
                // resolved to, so only definitions reads it off the targets.
                subjectFromTargets: true,
              },
              {
                name: "type_definitions",
                request: intelligence.typeDefinitions,
                document: "type-definitions.tool.mdoc",
                fromOrigin: false,
                subjectFromTargets: false,
              },
              {
                name: "implementations",
                request: intelligence.implementations,
                document: "implementations.tool.mdoc",
                fromOrigin: true,
                subjectFromTargets: false,
              },
            ] as const
          ).map(({ name, request, document, fromOrigin, subjectFromTargets }) => [
            name,
            async (ask: DocumentAsk) => {
              const position = await askedPosition(ask);
              const uri = workspace.getWorkspaceUri(askedFile(ask));
              const limit = Number(ask.attributes.limit ?? 50);
              const { result } = await request({
                file: askedFile(ask),
                signal,
                params: { position },
              });
              const targets = await navigationTargets({
                result,
                root,
                workspace,
                signal,
                limit,
                origin: fromOrigin ? { uri, position } : undefined,
              });
              const resolved = await subjectAtPosition({ workspace, uri, position, signal }).catch(
                () => undefined,
              );
              const subject = subjectFromTargets
                ? (targets.items.find(({ name: named }) => named)?.name ?? resolved?.name)
                : resolved?.name;
              const landedIn =
                targets.total === 0
                  ? await declarationAtPosition({ workspace, uri, position }).catch(() => undefined)
                  : undefined;
              const paths = [...new Set(targets.items.map(({ file }) => file))];
              const beyond = targets.total - targets.items.length;
              return {
                total: targets.total,
                shown: targets.items.length,
                beyond,
                any: targets.total > 0,
                files: paths.length,
                paths,
                // Places, so a composition can ask about each target it found.
                hits: targets.items.map((item) => ({
                  name: item.name,
                  file: item.file,
                  line: item.selection.start.line + 1,
                  character: item.selection.start.character + 1,
                })),
                // Through the tool's own document, because the empty case is
                // where these three carry their weight: an implementation
                // walk reaches only files this session has opened, and a bare
                // tree said nothing at all where the tool spends a paragraph
                // saying so — silence a composer would read as "there are
                // none".
                text: withRest(
                  await asDocument(document, {
                    subject,
                    kind: resolved?.kind,
                    root,
                    landedIn: landedIn?.name,
                    landedAt: landedIn?.selectionRange.start,
                    ...targets,
                    items: targets.items.map((item) =>
                      item.name === subject ? { ...item, name: undefined } : item,
                    ),
                  }),
                  beyond,
                  limit,
                ),
              };
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
      // An ask pointed at a list runs once per item of it. Every ask above
      // anchors on one place, so "hover each candidate that search returned"
      // or "outline every file using this" could only be spelled as N calls —
      // the round trip a composition exists to remove. The answers land as
      // `{title, text}`, which is what `sections` already renders.
      const fanned = async (ask: DocumentAsk, items: unknown, asked: unknown) => {
        // Fanning over something that is not a list is a broken composition,
        // never a reason to answer about nothing. Degrading to a single call
        // ran the operation with no anchor at all and reported "File is
        // outside the workspace: " — a hole wearing an answer's clothes.
        if (!Array.isArray(items)) {
          throw new Error(
            `each=${
              isAskReference(asked) ? `$${asked.reference.join(".")}` : "…"
            } is not a list — the ask it reads either failed above or binds no such field.`,
          );
        }
        // A language-server request per item, so the list is bounded — and
        // says how much of it it covered, because a silent cut reads as the
        // whole answer.
        const taken = items.slice(0, 10);
        const answers = await Promise.all(
          taken.map(async (item) => {
            // A string is a path; an object supplies its own fields. What the
            // composer wrote stays fixed — those attributes are the part that
            // is deliberately not varying.
            const { each, ...written } = ask.attributes;
            const fields =
              typeof item === "object" && item !== null
                ? (item as Record<string, unknown>)
                : { file: String(item) };
            const answer = (await operations[ask.operation]!({
              ...ask,
              attributes: { ...fields, ...written },
            }).catch((cause: unknown) => ({
              text: `Failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            }))) as Record<string, unknown>;
            // What this answer is about. The name alone is not enough to tell
            // the blocks apart — a search for `render` returned four
            // candidates all named `rendered`, which read as one heading
            // repeated four times until the place each was found came with it.
            const file = fields.file === undefined ? "" : String(fields.file);
            const at = file && fields.line !== undefined ? `${file}:${String(fields.line)}` : file;
            return {
              ...answer,
              title: [fields.name, at].filter(Boolean).map(String).join(" · ") || String(item),
              // Not every operation answers with prose — `subject` binds
              // fields only — and a section with no text is a crash. An empty
              // one is worse than a crash: `index.ts` re-exports and declares
              // nothing, and its heading sat blank among six that were full,
              // reading exactly like an ask that had failed.
              text: String(answer.text ?? "") || "Nothing to report.",
            };
          }),
        );
        return {
          items: answers,
          total: answers.length,
          any: answers.length > 0,
          of: items.length,
          text: await asText("{% sections items=$items /%}", { items: answers }),
        };
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
        bound[ask.bind] = await (
          ask.attributes.each === undefined
            ? operations[ask.operation]!(resolved)
            : fanned(resolved, resolved.attributes.each, ask.attributes.each)
        ).catch((cause: unknown) => ({
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
