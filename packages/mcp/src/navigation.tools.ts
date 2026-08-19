import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  GetMatchTsConfigRequest,
  type Range,
  type SymbolInformation,
  type WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationAtPosition,
  declarationChainAtPosition,
  inspectSymbol,
  page,
  renderDocument,
  subjectAtPosition,
  type VolarWorkspace,
} from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { rangeText as siteText, sameRange } from "atlascii";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { inspectionVariables } from "./inspection-variables.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { containsPosition, displayPath } from "atlascii";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, paginationInput, positionInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

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
  // A jump target answered as coordinates alone makes a reader open the file
  // to learn the one thing they asked. A LocationLink's selection spans the
  // identifier itself, so the text under it IS the name — the same fact the
  // references subject reads. Only a plain `Location` falls back to the
  // outline, because its range spans the whole declaration and slicing one
  // line of a 40-line type yields an empty string.
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
        const linked = "targetUri" in item;
        const uri = linked ? item.targetUri : item.uri;
        const selection = linked ? item.targetSelectionRange : item.range;
        const extent = linked ? item.targetRange : item.range;
        const sliced = linked
          ? await input.workspace
              .readTextDocumentUri(uri, input.signal)
              .then(({ source }) =>
                (source.split("\n")[selection.start.line] ?? "").slice(
                  selection.start.character,
                  selection.end.character,
                ),
              )
              .catch(() => undefined)
          : undefined;
        const declared = sliced
          ? undefined
          : await declarationAtPosition({
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
          // A name is an identifier. An overload signature's selection spans
          // the whole signature line, and the slice of it is a listing, not
          // a name — 74 characters of Effect's filter overload stood where
          // "filter" belonged.
          name:
            (sliced && /^[$A-Za-z_][\w$]*$/u.test(sliced) ? sliced : undefined) ??
            declared?.name,
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
}) => {
  const subject = input.items?.[0];
  const flat = (input.calls ?? []).flatMap((group) => group ?? []);
  const grouped = flat.reduce((files, call) => {
    const file = displayPath(input.callable(call).uri, input.root);
    return files.set(file, [...(files.get(file) ?? []), call]);
  }, new Map<string, Call[]>());
  return {
    name: subject?.name,
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
          kind: callable.kind,
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


/**
 * The kind TypeScript assigned to whatever stands at a position.
 *
 * The syntactic outline has no entry for a type's members and reports the
 * enclosing type instead, which is where `[variable]` came from for a property.
 * Hover states the kind two ways — parenthesised for things that are not
 * declarations in their own right, `(property) down: string`, and as the
 * declaring keyword otherwise, `const countHeader: …` — so both are read.
 */

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
): void => {
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
      const { project, projects, symbols } = await createTypeAtlas(workspace).workspaceSymbols({
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
        kind: symbol.kind,
        // TypeScript's own word when the server carried it — the number
        // cannot say "type", so a type alias projected as something it is
        // not until the word rode along.
        word: "word" in symbol ? (symbol as { word?: string }).word : undefined,
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
          anchor: project ? displayPath(project.uri, root) : undefined,
          // Null is a provider that did not answer; an empty array is one that
          // searched and found nothing. They read identically and mean opposite
          // things — the second says the name is absent, the first says nothing
          // at all — so the document is told which it has.
          answered: symbols !== null,
          // How many projects the fan-out asked — the observation that turns
          // "nothing matched" into a claim a reader can weigh.
          projects,
          total: output?.total ?? 0,
          items: named,
          // Only when the answer is a window — a whole set needs no page line.
          page:
            output && (output.nextOffset !== undefined || output.offset > 0)
              ? {
                  from: output.offset + 1,
                  to: output.offset + output.items.length,
                  total: output.total,
                  unit: "symbols",
                  next: output.nextOffset,
                }
              : undefined,
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
      // What the position RESOLVES TO is this answer's subject — the
      // target's own identifier. The hover-derived noun misread a call
      // site as its enclosing assignment ("targets" for a question about
      // navigationTargets), so it is only the fallback for answers whose
      // targets carry no name.
      const resolved = await subjectAtPosition({
        workspace,
        uri: textDocument.uri,
        position,
        signal,
      });
      const subject = targets.items.find(({ name }) => name)?.name || resolved?.name;
      const rendered = await renderDocument({
        document: "definitions.tool.mdoc",
        variables: {
          subject,
          kind: resolved?.kind,
          root,
          landedIn: landedIn?.name,
          landedAt: landedIn?.selectionRange.start,
          ...targets,
          // A row naming the subject repeats the line above it; a row naming
          // anything else is information. Overloads made the difference real:
          // two targets of one ask are not interchangeably "the subject".
          items: targets.items.map((item) =>
            item.name === subject ? { ...item, name: undefined } : item,
          ),
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
                ...(await subjectAtPosition({
                  workspace,
                  uri: textDocument.uri,
                  position,
                  signal,
                }).then((resolved) => ({ subject: resolved?.name, kind: resolved?.kind }))),
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
                ...(await subjectAtPosition({
                  workspace,
                  uri: textDocument.uri,
                  position,
                  signal,
                }).then((resolved) => ({ subject: resolved?.name, kind: resolved?.kind }))),
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
      const { textDocument, items, calls, projects } = await createTypeAtlas(workspace).callers({
        file,
        position,
        signal,
      });
      const rendered = await renderDocument({
        document: "callers.tool.mdoc",
        variables: {
          ...callHierarchyVariables<CallHierarchyIncomingCall>({
            items,
            calls,
            root,
            callable: (call) => call.from,
          }),
          // Callers assembles from the reference fan-out, so its reach is the
          // same count of projects asked; callees is document-scoped and has
          // no such number.
          projects,
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
      const { textDocument, result: references, projects } = await intelligence.references({
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
      const output =
        references === null
          ? null
          : raw
            ? page(references, 0, references.length)
            : page(references, offset, limit);
      // What the position resolved to, from the one subject owner — the name
      // this answer opens with, and the declaration site the rows below mark
      // themselves against. This replaced a hover noun and a hand-rolled
      // definition slice that each failed their own way.
      const resolved = await subjectAtPosition({
        workspace,
        uri: textDocument.uri,
        position,
        signal,
      });
      const declarationUri = resolved?.declaredAt.uri;
      const declarationRange = resolved?.declaredAt.selection;
      // Concurrent over the page: each row's owner is one outline chain, and
      // awaiting them one by one serialized twenty file reads behind each
      // other — the tool-layer share of a references answer that breached
      // the one-second calibration. The page is bounded, so so is the fan.
      const sites = await Promise.all(
        (output?.items ?? []).map(async ({ uri, range }) => {
          const chain = await declarationChainAtPosition({
            workspace,
            uri,
            position: range.start,
          }).catch(() => []);
          // The innermost declaration is often the reference itself — an
          // object-literal property is a declaration in the outline — so the
          // holder is the last one that does not stand on this very position.
          const owner = enclosingDeclaration(chain, range);
          return {
            file: displayPath(uri, root),
            line: range.start.line + 1,
            character: range.start.character + 1,
            within: owner?.name,
            declaration:
              uri === declarationUri &&
              declarationRange !== undefined &&
              declarationRange.start.line === range.start.line &&
              declarationRange.start.character === range.start.character,
          };
        }),
      );
      const ordered = [...sites].sort(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.character - right.character,
      );
      const declarationSite = ordered.find((site) => site.declaration);
      const uses = ordered.filter((site) => !site.declaration);
      const matched = await project;
      const rendered = await renderDocument({
        document: "references.tool.mdoc",
        variables: {
          subject: resolved?.name,
          kind: resolved?.kind,
          // A top-level declaration is its own enclosing declaration, so the
          // outline names it as its own container — which says nothing.
          container:
            declarationSite?.within === resolved?.name ? undefined : declarationSite?.within,
          // From the definition itself, not from the page rows: the subject
          // line owes its location in every state, and deriving it from the
          // page dropped it whenever the declaration row fell outside the
          // window — project scope with includeDeclaration answered a
          // located list under an unlocated subject.
          declaredAt:
            declarationUri && declarationRange
              ? { file: displayPath(declarationUri, root), at: declarationRange.start }
              : undefined,
          everyProject: scope === "workspace",
          // How many projects the fan-out asked — the observation that says
          // how far "found N references" actually reaches.
          projects,
          // The project, or nothing. What to say when a file belongs to no
          // configured project is a sentence, and sentences are the document's
          // — this decided between two English phrases here, in a package that
          // is supposed to hold none.
          anchor: matched ? displayPath(matched.uri, root) : undefined,
          total: output?.total ?? 0,
          // Exact at offset 0, where a declaration row can appear; deeper
          // windows always have more references than one declaration.
          noUses: (output?.total ?? 0) - (declarationSite ? 1 : 0) <= 0,
          page:
            output && (output.nextOffset !== undefined || output.offset > 0)
              ? {
                  from: output.offset + 1,
                  to: output.offset + output.items.length,
                  total: output.total,
                  unit: "references",
                  next: output.nextOffset,
                }
              : undefined,
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
      const { result, projects } = await createTypeAtlas(workspace).fileReferences({
        file,
        signal,
      });
      const output =
        result === null || result === undefined
          ? null
          : raw
            ? page(result, 0, result.length)
            : page(result, offset, limit);
      // A bare `40:10` names no declaration and resolves from nowhere. The same
      // two facts every located answer owes a reader — which declaration holds
      // this, and a path that opens — apply here.
      // Concurrent over the bounded page, as the references rows are.
      const sites = await Promise.all(
        (output?.items ?? []).map(async ({ uri, range }) => {
          const chain = await declarationChainAtPosition({
            workspace,
            uri,
            position: range.start,
          }).catch(() => []);
          const owner = enclosingDeclaration(chain, range);
          return {
            file: displayPath(uri, root),
            line: range.start.line + 1,
            character: range.start.character + 1,
            within: owner?.name,
          };
        }),
      );
      const matched = await project;
      const rendered = await renderDocument({
        document: "file-references.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          anchor: matched ? displayPath(matched.uri, root) : undefined,
          projects,
          total: output?.total ?? 0,
          page:
            output && (output.nextOffset !== undefined || output.offset > 0)
              ? {
                  from: output.offset + 1,
                  to: output.offset + output.items.length,
                  total: output.total,
                  unit: "places",
                  next: output.nextOffset,
                }
              : undefined,
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
      // The one subject owner, replacing this handler's own slice copy and
      // its separate kind request.
      const resolved = await subjectAtPosition({
        workspace,
        uri: textDocument.uri,
        position,
        signal,
      });
      // One document, so the path belongs in the sentence and not above a group
      // of one: printing it as a heading over its own rows stated it twice.
      // Concurrent over the highlights, as every sibling's rows are.
      const sites = await Promise.all(
        highlights.map(async ({ range }) => {
          const chain = await declarationChainAtPosition({
            workspace,
            uri: textDocument.uri,
            position: range.start,
          }).catch(() => []);
          return {
            file: displayPath(textDocument.uri, root),
            line: range.start.line + 1,
            character: range.start.character + 1,
            within: enclosingDeclaration(chain, range)?.name,
          };
        }),
      );
      const rendered = await renderDocument({
        document: "document-highlights.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          subject: resolved?.name,
          kind: resolved?.kind,
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
