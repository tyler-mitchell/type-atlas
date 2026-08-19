import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  GetMatchTsConfigRequest,
  type Location,
  type Range,
  SymbolKind,
  type SymbolInformation,
  type WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationAtPosition,
  declarationChainAtPosition,
  inspectSymbol,
  noun,
  page,
  renderDocument,
  type VolarWorkspace,
} from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { rangeText as siteText, sameRange } from "atlascii";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { inspectionVariables } from "./inspection-variables.ts";
import { referenceGroups } from "./reference-groups.ts";
import { createRetrievalIntelligence } from "./intelligence.ts";
import type { Semble } from "./semble.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  containsPosition,
  rangeText,
  symbolKind,
  displayPath,
} from "atlascii";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, paginationInput, positionInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

/**
 * Reads the lines a page of locations lands on, once per file.
 *
 * A range alone says where a reference is, never what it is, so every reading
 * of one costs a second call to open the file. The files are already on disk
 * and each is read once for however many locations it holds.
 */
const locationSourceLines = async (
  workspace: Awaited<ReturnType<VolarWorkspacePool["get"]>>,
  locations: readonly Location[] | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, readonly string[]> | undefined> => {
  if (!locations?.length) return undefined;
  const uris = [...new Set(locations.map(({ uri }) => uri))];
  const read = await Promise.all(
    uris.map(async (uri) => {
      const source = await workspace
        .readTextDocumentUri(uri, signal)
        .then(({ source }) => source)
        .catch(() => undefined);
      return [uri, source?.split("\n")] as const;
    }),
  );
  return new Map(read.flatMap(([uri, lines]) => (lines ? [[uri, lines] as const] : [])));
};

/**
 * Names a result after the identifier its position landed in.
 *
 * A bare count answers a question the reader has to remember having asked, and a
 * position that resolved to a neighbouring symbol reads exactly like one that
 * resolved correctly. Reading the line costs no language-server request.
 */
/**
 * Shapes navigation results into the records a document renders.
 *
 * `origin` carries one rule rather than any layout: the implementation request
 * answers with the declaration itself for anything not overridden, and a lone
 * target spanning the asked-about position means there are none.
 */
const navigationTargets = async (input: {
  readonly result: unknown;
  readonly root: string;
  readonly workspace: VolarWorkspace;
  readonly signal: AbortSignal;
  readonly origin?: { readonly uri: string; readonly position: { line: number; character: number } };
}) => {
  const { result, root, origin } = input;
  // A jump target answered as coordinates alone makes a reader open the file to
  // learn what is there. The name comes from the outline rather than the text
  // under the range: a plain `Location` carries no identifier range, so its
  // range spans the whole declaration — slicing one line of a 40-line type
  // yielded an empty string every time.
  const all = !result ? [] : Array.isArray(result) ? result : [result];
  const declaresOrigin =
    origin !== undefined &&
    all.length === 1 &&
    all.every((item) => {
      const uri = "targetUri" in item ? item.targetUri : item.uri;
      const range = "targetUri" in item ? item.targetRange : item.range;
      return uri === origin.uri && containsPosition(range, origin.position);
    });
  const found = declaresOrigin ? [] : all;
  return {
    declaresOrigin,
    total: found.length,
    items: await Promise.all(
      found.map(async (item) => {
        const uri = "targetUri" in item ? item.targetUri : item.uri;
        const selection = "targetUri" in item ? item.targetSelectionRange : item.range;
        const extent = "targetUri" in item ? item.targetRange : item.range;
        const declared = await declarationAtPosition({
          workspace: input.workspace,
          uri,
          position: selection.start,
        }).catch(() => undefined);
        return {
          file: displayPath(uri, root),
          selection,
          // Named only when it differs from the selection: repeating an
          // identifier's own span costs a second read to learn nothing.
          extent: sameRange(extent, selection) ? undefined : extent,
          name: declared?.name,
        };
      }),
    ),
  };
};

/**
 * Shapes one call-hierarchy direction into the variables both call documents read.
 *
 * The two directions carry the same parts — a prepared callable, and calls that
 * each name another callable with the ranges where the relationship shows — and
 * differ only in which side of a call that other callable sits on.
 */
const callHierarchyVariables = <Call extends { readonly fromRanges: readonly Range[] }>(input: {
  readonly items: readonly CallHierarchyItem[] | null;
  readonly calls: readonly (readonly Call[] | null)[] | null;
  readonly root: string;
  readonly callable: (call: Call) => CallHierarchyItem;
  readonly scope?: string;
}) => {
  const subject = input.items?.[0];
  const flat = (input.calls ?? []).flatMap((group) => group ?? []);
  const grouped = flat.reduce((files, call) => {
    const file = displayPath(input.callable(call).uri, input.root);
    return files.set(file, [...(files.get(file) ?? []), call]);
  }, new Map<string, Call[]>());
  return {
    name: subject?.name,
    scope: input.scope,
    total: flat.length,
    origin: subject
      ? [
          {
            file: displayPath(subject.uri, input.root),
            selection: subject.selectionRange,
            range: subject.range,
          },
        ]
      : [],
    groups: [...grouped].map(([file, entries]) => ({
      file,
      children: entries.map((call) => {
        const callable = input.callable(call);
        return {
          name: callable.name,
          kind: symbolKind(callable.kind),
          selection: callable.selectionRange,
          extent: sameRange(callable.range, callable.selectionRange)
            ? undefined
            : callable.range,
          // One position per site: a call hierarchy reports the same range once
          // per overload it resolved through.
          sites: [...new Set(call.fromRanges.map((site) => siteText(site)))],
        };
      }),
    })),
  };
};

const navigationNoun = async (input: {
  readonly base: string;
  readonly preposition?: string;
  readonly workspace: Awaited<ReturnType<VolarWorkspacePool["get"]>>;
  readonly uri: string;
  readonly position: { readonly line: number; readonly character: number };
  readonly signal: AbortSignal;
}) => {
  const declaration = await declarationAtPosition({
    workspace: input.workspace,
    uri: input.uri,
    position: input.position,
  }).catch(() => undefined);
  // The bare name. The kind used to be appended as `name [variable]`, taken
  // from the syntactic outline — which has no entry for a type's members and so
  // reported the enclosing type's kind for a property. Every consumer now reads
  // the kind from hover, where TypeScript states it, and printing both produced
  // sentences that disagreed with themselves: `references [variable] is a const`.
  const subject = declaration?.name;
  return {
    subject,
    noun: subject ? `${input.base} ${input.preposition ?? "of"} ${subject}` : input.base,
  };
};

/**
 * The kind TypeScript assigned to whatever stands at a position.
 *
 * The syntactic outline has no entry for a type's members and reports the
 * enclosing type instead, which is where `[variable]` came from for a property.
 * Hover states the kind two ways — parenthesised for things that are not
 * declarations in their own right, `(property) down: string`, and as the
 * declaring keyword otherwise, `const countHeader: …` — so both are read.
 */
const kindAt = (input: {
  readonly intelligence: ReturnType<typeof createTypeAtlas>;
  readonly file: string;
  readonly position: { readonly line: number; readonly character: number };
  readonly signal: AbortSignal;
}) =>
  input.intelligence
    .hover({ file: input.file, signal: input.signal, params: { position: input.position } })
    .then(({ result }) => {
      const contents = result?.contents;
      const text =
        typeof contents === "object" && contents && "value" in contents
          ? String(contents.value)
          : "";
      const kind =
        /\((?<kind>[a-z ]+)\)/.exec(text)?.groups?.kind ??
        /^(?:```\w*\s*)?(?<kind>const|let|var|function|class|interface|type|enum|namespace|module)\b/m.exec(
          text,
        )?.groups?.kind;
      // The bare kind. Which article belongs in front of it is English grammar,
      // and grammar is the document's to state.
      return kind;
    })
    .catch(() => undefined);

/** Declarations that hold other code, rather than merely name a value. */
const holdingKinds = new Set<number>([
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Constructor,
  SymbolKind.Class,
  SymbolKind.Interface,
  SymbolKind.Enum,
  SymbolKind.Module,
  SymbolKind.Namespace,
]);

/**
 * The declaration a reference sits in, as a reader would name it.
 *
 * Two entries in the chain are never the answer. The reference's own
 * declaration is one — an object-literal property is a declaration in the
 * outline, so `down: "↓"` reported "inside down". A local binding is the other:
 * `const lines = references(...)` reported "inside lines", where what holds the
 * call is the function around it. So the innermost holder wins, and only when
 * the chain has none does the innermost remaining declaration answer — which is
 * what names a top-level `const figures` as the holder of the properties in it.
 */
const enclosingDeclaration = (
  chain: readonly {
    readonly name?: string;
    readonly kind?: number;
    readonly selectionRange: Range;
  }[],
  range: Range,
) => {
  const others = [...chain]
    .reverse()
    .filter(
      (entry) =>
        entry.selectionRange.start.line !== range.start.line ||
        entry.selectionRange.start.character !== range.start.character,
    );
  return others.find((entry) => entry.kind !== undefined && holdingKinds.has(entry.kind)) ?? others[0];
};

const referenceScopeInput = type("'project' | 'workspace'").configure(
  {
    default: "workspace",
    description:
      "Projects searched: workspace (every project loaded this session, default) or project (only the file's owning project). The result states which it used.",
  },
  "self",
);

const inspectOptions = {
  ...observedFileInput,
  "scope?": referenceScopeInput,
  "compactExternalCalls?": type("boolean").configure({
    default: true,
    description:
      "Summarize dependency and JavaScript runtime call targets while workspace calls retain exact ranges. Pass false for complete external call details.",
  }),
  "includeSource?": type("boolean").configure({
    default: false,
    description: "Include the complete symbol body.",
  }),
  "includeTypeDefinitions?": type("boolean").configure({
    default: false,
    description: "Include callable type-definition targets.",
  }),
  "limit?": type("1 <= number.integer <= 100").configure({
    default: 20,
    description:
      "Maximum callers, callees, references, and ambiguity candidates shown per section.",
  }),
} as const;

const input = type.module({
  Position: type({
    ...observedFileInput,
    position: positionInput,
  }),
  References: type({
    ...observedFileInput,
    position: positionInput,
    "scope?": referenceScopeInput,
    "includeDeclaration?": type("boolean").configure({
      description: "Include the symbol's own declaration among the results.",
    }),
    ...paginationInput,
  }),
  FileReferences: type({
    ...observedFileInput,
    ...paginationInput,
  }),
  WorkspaceSymbols: type({
    ...fileInput,
    query: type("string").describe(
      "Use a specific symbol name; avoid broad speculative queries in large workspaces.",
    ),
    "offset?": paginationInput["offset?"],
    "limit?": type("1 <= number.integer <= 100").describe(
      "Maximum results returned; this does not reduce the underlying workspace search.",
    ),
    "raw?": type("boolean").describe(
      "Return every matching symbol; potentially very large in monorepos.",
    ),
  }),
  InspectSymbol: type({
    ...inspectOptions,
    "position?": positionInput.describe(
      "Source position of the symbol, as a one-based { line, character }. Pass either this or symbol, not both.",
    ),
    "symbol?": type("string >= 1").describe(
      "Exact document-symbol name in the file, such as createServer. Pass either this or position, not both. Ambiguous matches are returned as candidates.",
    ),
  }),
});

/**
 * Resolves the one selector `inspect_symbol` and `explore_symbol` accept.
 *
 * A schema union would state this exactly, but MCP publishes tool input as an
 * object schema and cannot express a choice between shapes, so both selectors
 * are optional keys and the requirement is enforced here — where the message
 * can name what was actually wrong.
 */
export const symbolTarget = (target: {
  readonly position?: { readonly line: number; readonly character: number };
  readonly symbol?: string;
}) => {
  if (target.symbol !== undefined && target.position !== undefined) {
    throw new Error("Pass either symbol or position, not both.");
  }
  if (target.symbol !== undefined) return { symbol: target.symbol };
  if (target.position !== undefined) return { position: target.position };
  throw new Error("Pass symbol (an exact document-symbol name) or position to select a symbol.");
};

export const registerNavigationTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const retrieval = createRetrievalIntelligence({ semble, workspaces });
  registerTool(
    server,
    "inspect_symbol",
    {
      title: "Inspect symbol",
      description:
        "Return a bounded working view of a symbol: type and documentation, exact definition/body ranges, distinct implementations and types, callers, direct calls, remaining references, project scope, and optional source. Select by exact file-local symbol name or source position.",
      inputSchema: input.InspectSymbol,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        includeDiagnostics,
        scope = "workspace",
        compactExternalCalls = true,
        includeSource = false,
        includeTypeDefinitions = false,
        limit = 20,
        ...target
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const result = await inspectSymbol({
        workspace,
        root,
        file,
        target: symbolTarget(target),
        options: { compactExternalCalls, scope, includeSource, includeTypeDefinitions, limit },
        signal,
      });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        result.textDocument,
        root,
        includeDiagnostics,
        signal,
        result.position,
      );
      const rendered = await renderDocument({
        document: "inspect-symbol.tool.mdoc",
        variables: inspectionVariables({ result, root }),
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "workspace_symbols",
    {
      title: "Workspace symbols",
      description:
        "Search symbols across TypeScript projects activated in this workspace session. Potentially expensive in large monorepos: each call may search many project files, and limit only bounds returned output. Use document_symbols when the file is known; avoid parallel or repeated speculative searches.",
      inputSchema: input.WorkspaceSymbols,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, query, offset = 0, limit = 10, raw = false },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const { project, symbols } = await createTypeAtlas(workspace).workspaceSymbols({
        file,
        query,
        signal,
      });
      const output =
        symbols === null
          ? null
          : raw
            ? page<SymbolInformation | WorkspaceSymbol>(symbols, 0, symbols.length)
            : page<SymbolInformation | WorkspaceSymbol>(symbols, offset, limit);
      const named = (output?.items ?? []).map((symbol) => ({
        name: symbol.name,
        kind: symbolKind(symbol.kind),
        deprecated: ("deprecated" in symbol && symbol.deprecated) || symbol.tags?.includes(1),
        file: displayPath(symbol.location.uri, root),
        range:
          "range" in symbol.location && symbol.location.range ? symbol.location.range : undefined,
        container: symbol.containerName,
      }));
      const rendered = await renderDocument({
        document: "workspace-symbols.tool.mdoc",
        variables: {
          query,
          anchor: project ? displayPath(project.uri, root) : "an inferred project",
          root,
          // Null is a provider that did not answer; an empty array is one that
          // searched and found nothing. They read identically and mean opposite
          // things — the second says the name is absent, the first says nothing
          // at all — so the document is told which it has.
          answered: symbols !== null,
          total: output?.total ?? 0,
          items: named,
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "definitions",
    {
      title: "Definitions",
      description: "Return definition locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, result: definitions } = await createTypeAtlas(workspace).definitions({
        file,
        signal,
        params: { position },
      });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const targets = await navigationTargets({ result: definitions, root, workspace, signal });
      // An empty answer that only says "check the position" costs a second call
      // to find out what the position actually hit — a file edited since the
      // last answer moves every symbol under it. The declaration the position
      // landed in, and where its name sits, is what the caller was going to ask
      // for next.
      const landedIn =
        targets.total === 0
          ? await declarationAtPosition({ workspace, uri: textDocument.uri, position }).catch(
              () => undefined,
            )
          : undefined;
      const rendered = await renderDocument({
        document: "definitions.tool.mdoc",
        variables: {
          subject: (
            await navigationNoun({
              base: "definitions",
              workspace,
              uri: textDocument.uri,
              position,
              signal,
            })
          ).subject,
          kind: await kindAt({ intelligence: createTypeAtlas(workspace), file, position, signal }),
          root,
          landedIn: landedIn?.name,
          landedAt: landedIn?.selectionRange.start,
          ...targets,
          // A definition's target is the subject itself, so naming it on the row
          // repeats the sentence above. A type definition's is not, which is why
          // the name is dropped here rather than in the component.
          items: targets.items.map((item) => ({ ...item, name: undefined })),
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "type_definitions",
    {
      title: "Type definitions",
      description: "Return type-definition locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, result } = await createTypeAtlas(workspace).typeDefinitions({
        file,
        signal,
        params: { position },
      });
      return appendDiagnosticContext(
        textResult(
          (
            await renderDocument({
              document: "type-definitions.tool.mdoc",
              variables: {
                subject: (
                  await navigationNoun({
                    base: "type definitions",
                    workspace,
                    uri: textDocument.uri,
                    position,
                    signal,
                  })
                ).subject,
                kind: await kindAt({
                  intelligence: createTypeAtlas(workspace),
                  file,
                  position,
                  signal,
                }),
                root,
                ...(await navigationTargets({ result, root, workspace, signal })),
              },
            })
          ).text,
        ),
        await requestDiagnosticContext(
          workspace,
          textDocument,
          root,
          includeDiagnostics,
          signal,
          position,
        ),
      );
    },
  );

  registerTool(
    server,
    "implementations",
    {
      title: "Implementations",
      description: "Return implementation locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, result } = await createTypeAtlas(workspace).implementations({
        file,
        signal,
        params: { position },
      });
      return appendDiagnosticContext(
        textResult(
          (
            await renderDocument({
              document: "implementations.tool.mdoc",
              variables: {
                subject: (
                  await navigationNoun({
                    base: "implementations",
                    workspace,
                    uri: textDocument.uri,
                    position,
                    signal,
                  })
                ).subject,
                kind: await kindAt({
                  intelligence: createTypeAtlas(workspace),
                  file,
                  position,
                  signal,
                }),
                root,
                ...(await navigationTargets({
                  result,
                  root,
                  workspace,
                  signal,
                  origin: { uri: textDocument.uri, position },
                })),
              },
            })
          ).text,
        ),
        await requestDiagnosticContext(
          workspace,
          textDocument,
          root,
          includeDiagnostics,
          signal,
          position,
        ),
      );
    },
  );

  registerTool(
    server,
    "callers",
    {
      title: "Callers",
      description:
        "Show which functions call the callable symbol at a position, grouped by caller with exact call sites. Use this instead of references when tracing incoming execution flow.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, items, calls } = await createTypeAtlas(workspace).callers({
        file,
        position,
        signal,
      });
      const rendered = await renderDocument({
        document: "callers.tool.mdoc",
        variables: callHierarchyVariables<CallHierarchyIncomingCall>({
          items,
          calls,
          root,
          callable: (call) => call.from,
          scope: "loaded projects",
        }),
      });
      return appendDiagnosticContext(
        textResult(rendered.text),
        await requestDiagnosticContext(
          workspace,
          textDocument,
          root,
          includeDiagnostics,
          signal,
          position,
        ),
      );
    },
  );

  registerTool(
    server,
    "callees",
    {
      title: "Callees",
      description:
        "Show which callable symbols are invoked directly by the function at a position, grouped with exact call sites. Use this instead of references when tracing outgoing execution flow.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, items, calls } = await createTypeAtlas(workspace).callees({
        file,
        position,
        signal,
      });
      const rendered = await renderDocument({
        document: "callees.tool.mdoc",
        variables: callHierarchyVariables<CallHierarchyOutgoingCall>({
          items,
          calls,
          root,
          callable: (call) => call.to,
        }),
      });
      return appendDiagnosticContext(
        textResult(rendered.text),
        await requestDiagnosticContext(
          workspace,
          textDocument,
          root,
          includeDiagnostics,
          signal,
          position,
        ),
      );
    },
  );

  registerTool(
    server,
    "references",
    {
      title: "References",
      description:
        "Return a bounded page of reference locations, across every project loaded this session unless scope narrows it. Set raw to return the complete scope instead of one page.",
      inputSchema: input.References,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        position,
        includeDeclaration = true,
        scope = "workspace",
        offset = 0,
        limit = 20,
        raw = false,
        includeDiagnostics,
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, result: references } = await intelligence.references({
        file,
        signal,
        params: { position, context: { includeDeclaration }, scope },
      });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const project = workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal);
      const { subject } = await navigationNoun({
        base: "references",
        workspace,
        uri: textDocument.uri,
        position,
        signal,
      });
      const output =
        references === null
          ? null
          : raw
            ? page(references, 0, references.length)
            : page(references, offset, limit);
      // What a reader wants from a hit is which declaration holds it, not the
      // line it sits on: a use split across lines shows a fragment, and the
      // owner's name says what the fragment was trying to say. The outline is
      // syntactic and cached per file, so a page of hits in one module costs
      // one parse.
      // Which hit is the declaration is not derivable from the outline: an
      // object-literal property is a declaration there, so `down: "↓"` claimed
      // to declare the type member it assigns. The definition request answers
      // it exactly, and it is one request for the whole page.
      const defined = (await intelligence
        .definitions({ file, signal, params: { position } })
        .then(({ result }) => (Array.isArray(result) ? result[0] : result))
        .catch(() => undefined)) as { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range } | undefined;
      const declarationUri = defined?.targetUri ?? defined?.uri;
      const declarationRange = defined?.targetSelectionRange ?? defined?.range;
      // The heading named the enclosing declaration, so pointing at a type's
      // member reported the type: `Figures [variable]` for a question about
      // `down`. The definition's selection range spans the identifier itself,
      // and the text under it is the symbol that was actually resolved.
      const declarationSource =
        declarationUri && declarationRange
          ? await workspace
              .readTextDocumentUri(declarationUri, signal)
              .then(({ source }) =>
                (source.split("\n")[declarationRange.start.line] ?? "").slice(
                  declarationRange.start.character,
                  declarationRange.end.character,
                ),
              )
              .catch(() => undefined)
          : undefined;
      const sites = [];
      for (const { uri, range } of output?.items ?? []) {
        const chain = await declarationChainAtPosition({
          workspace,
          uri,
          position: range.start,
        }).catch(() => []);
        // The innermost declaration is often the reference itself — an
        // object-literal property is a declaration in the outline — so the
        // holder is the last one that does not stand on this very position.
        const owner = enclosingDeclaration(chain, range);
        sites.push({
          file: displayPath(uri, root),
          line: range.start.line + 1,
          character: range.start.character + 1,
          within: owner?.name,
          declaration:
            uri === declarationUri &&
            declarationRange !== undefined &&
            declarationRange.start.line === range.start.line &&
            declarationRange.start.character === range.start.character,
        });
      }
      const ordered = [...sites].sort(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.character - right.character,
      );
      const declarationSite = ordered.find((site) => site.declaration);
      const uses = ordered.filter((site) => !site.declaration);
      const kind = await kindAt({ intelligence, file, position, signal });
      const matched = await project;
      const rendered = await renderDocument({
        document: "references.tool.mdoc",
        variables: {
          subject: declarationSource || subject,
          kind,
          // A top-level declaration is its own enclosing declaration, so the
          // outline names it as its own container — which says nothing.
          container:
            declarationSite?.within === (declarationSource || subject)
              ? undefined
              : declarationSite?.within,
          declaredAt: declarationSite
            ? {
                file: declarationSite.file,
                // Already counted from one, so it is stated as it stands.
                at: { line: declarationSite.line - 1, character: declarationSite.character - 1 },
              }
            : undefined,
          // The root is stated once and every path below is relative to it.
          // Naming it on each row repeated fifty characters a line; leaving it
          // out entirely left `tsconfig.json` naming no project in particular.
          everyProject: scope === "workspace",
          anchor: matched
            ? displayPath(matched.uri, root)
            : scope === "workspace"
              ? "an inferred project"
              : "the project inferred for this file",
          root,
          total: output?.total ?? 0,
          useCount: uses.length,
          useNoun: noun({ count: uses.length, singular: "use", plural: "uses" }),
          groups: referenceGroups(uses),
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "file_references",
    {
      title: "File references",
      description:
        "Return a bounded page of module references from the TypeScript project selected by file. Set raw to return every project-scoped reference.",
      inputSchema: input.FileReferences,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, offset = 0, limit = 20, raw = false, includeDiagnostics },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const project = workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal);
      const { result } = await createTypeAtlas(workspace).fileReferences({ file, signal });
      const output =
        result === null || result === undefined
          ? null
          : raw
            ? page(result, 0, result.length)
            : page(result, offset, limit);
      // A bare `40:10` names no declaration and resolves from nowhere. The same
      // two facts every located answer owes a reader — which declaration holds
      // this, and a path that opens — apply here.
      const sites = [];
      for (const { uri, range } of output?.items ?? []) {
        const chain = await declarationChainAtPosition({
          workspace,
          uri,
          position: range.start,
        }).catch(() => []);
        const owner = enclosingDeclaration(chain, range);
        sites.push({
          file: displayPath(uri, root),
          line: range.start.line + 1,
          character: range.start.character + 1,
          within: owner?.name,
        });
      }
      const matched = await project;
      const rendered = await renderDocument({
        document: "file-references.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          anchor: matched ? displayPath(matched.uri, root) : "an inferred project",
          root,
          total: output?.total ?? 0,
          groups: referenceGroups(
            [...sites].sort(
              (left, right) =>
                left.file.localeCompare(right.file) ||
                left.line - right.line ||
                left.character - right.character,
            ),
          ),
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "document_highlights",
    {
      title: "Document highlights",
      description: "Return same-document semantic usages at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, result } = await createTypeAtlas(workspace).documentHighlights({
        file,
        signal,
        params: { position },
      });
      const highlights = result ?? [];
      const intelligence = createTypeAtlas(workspace);
      const kind = await kindAt({ intelligence, file, position, signal });
      // One document, so the path belongs in the sentence and not above a group
      // of one: printing it as a heading over its own rows stated it twice.
      const sites = [];
      for (const { range } of highlights) {
        const chain = await declarationChainAtPosition({
          workspace,
          uri: textDocument.uri,
          position: range.start,
        }).catch(() => []);
        sites.push({
          file: displayPath(textDocument.uri, root),
          line: range.start.line + 1,
          character: range.start.character + 1,
          within: enclosingDeclaration(chain, range)?.name,
        });
      }
      // Every highlight is the same symbol, so the text under any of them is its
      // name; the one on the queried line is preferred so a caller sees the name
      // they pointed at.
      const source = await workspace
        .readTextDocumentUri(textDocument.uri, signal)
        .then(({ source: text }) => text.split("\n"))
        .catch(() => [] as string[]);
      const named =
        highlights.find(({ range }) => range.start.line === position.line) ?? highlights[0];
      const rendered = await renderDocument({
        document: "document-highlights.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          subject: named
            ? (source[named.range.start.line] ?? "").slice(
                named.range.start.character,
                named.range.end.character,
              )
            : undefined,
          kind,
          total: highlights.length,
          groups: referenceGroups(
            [...sites].sort(
              (left, right) => left.line - right.line || left.character - right.character,
            ),
          ),
        },
      });
      return appendDiagnosticContext(
        textResult(rendered.text),
        await requestDiagnosticContext(
          workspace,
          textDocument,
          root,
          includeDiagnostics,
          signal,
          position,
        ),
      );
    },
  );
};
