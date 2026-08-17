import {
  CallHierarchyIncomingCallsRequest,
  type CallHierarchyItem,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  type Location,
  type LocationLink,
  type Position,
  type Range,
  ReferencesRequest,
  type ReferenceParams,
  SymbolKind,
  type DocumentSymbol,
  TypeDefinitionRequest,
} from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import { sourceLines } from "./folded-source.ts";
import { documentSymbols } from "./syntactic-features.ts";
import { URI } from "vscode-uri";
import { hoverContentsText, rangeText, symbolKind, workspacePath } from "./plain-text.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

/** Selects either an exact document-symbol name or an LSP source position. */
export type InspectSymbolTarget = { readonly position: Position } | { readonly symbol: string };

/** Controls expensive source and type sections and bounds repeated relationships. */
export type InspectSymbolOptions = {
  readonly compactExternalCalls?: boolean;
  readonly crossProject?: boolean;
  readonly includeSource: boolean;
  readonly includeTypeDefinitions: boolean;
  readonly limit: number;
};

type Located = {
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly name?: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly sourceLine?: string;
};

type RelatedCall = {
  readonly item: CallHierarchyItem;
  readonly siteUri: string;
  readonly sites: readonly Range[];
};

/** A call and the exact places it happens, as the call hierarchy reports them. */
export type CallSite = {
  readonly item: Located & { readonly name: string; readonly kind: SymbolKind };
  readonly siteUri: string;
  readonly sites: readonly Range[];
};

/**
 * What the language server was asked and answered about one symbol.
 *
 * Composing the answer is the operation's product; rendering it is the
 * caller's, so a consumer that is not this MCP presents the same inspection
 * its own way. `choice` stands in for the rest when a name is ambiguous or
 * unresolved, carrying the bounded candidates instead of an answer.
 */
export type InspectSymbolResult = {
  readonly textDocument: { readonly uri: string };
  readonly position?: Position;
  readonly choice?: {
    readonly reason: "ambiguous" | "not found";
    readonly name: string;
    readonly candidates: readonly Located[];
    readonly total: number;
  };
  readonly primary?: Located;
  readonly name?: string;
  readonly project?: string | undefined;
  readonly hover?: string | undefined;
  readonly additionalDefinitions?: readonly Located[];
  readonly implementations?: readonly Located[];
  readonly typeDefinitions?: readonly Located[];
  readonly callers?: readonly CallSite[];
  readonly callees?: readonly CallSite[];
  readonly sharedCalleeUri?: string | undefined;
  readonly compactExternalCalls?: boolean;
  readonly limit?: number;
  readonly references?: {
    readonly shown: readonly Located[];
    readonly other: number;
    readonly total: number;
  };
  readonly source?: readonly string[] | undefined;
};

const located = (symbol: DocumentSymbol, uri: string): Located => ({
  uri,
  name: symbol.name,
  kind: symbol.kind,
  range: symbol.range,
  selectionRange: symbol.selectionRange,
  ...(symbol.detail ? { detail: symbol.detail } : {}),
});

/**
 * Every declaration in an outline, outermost first.
 *
 * Yielded rather than returned as an array. An outline of a large file nests
 * deeply — an object literal of generic factories reaches a dozen levels — and
 * building the flat list by spreading each subtree's array into its parent's
 * copies the tail of the file once per level it sits under. On this repository's
 * 1,225-line resource module that cost 1.3 seconds, more than the whole
 * inspection around it; the callers below want a search or a first match, so
 * none of them need the array at all.
 */
function* declarations(
  symbols: readonly DocumentSymbol[],
  uri: string,
): Generator<Located, void, undefined> {
  for (const symbol of symbols) {
    yield located(symbol, uri);
    yield* declarations(symbol.children ?? [], uri);
  }
}

/**
 * The innermost declaration containing a position.
 *
 * An outline is a tree, so the answer is one descent through the branch that
 * contains the position — not a search over every declaration in the file.
 */
const enclosing = (input: {
  readonly symbols: readonly DocumentSymbol[];
  readonly position: Position;
  readonly uri: string;
}): Located | undefined => {
  const branch = input.symbols.find(({ range }) => contains(range, input.position));
  if (!branch) return undefined;
  return (
    enclosing({ symbols: branch.children ?? [], position: input.position, uri: input.uri }) ??
    located(branch, input.uri)
  );
};

const contains = (range: Range, position: Position) =>
  (range.start.line < position.line ||
    (range.start.line === position.line && range.start.character <= position.character)) &&
  (position.line < range.end.line ||
    (position.line === range.end.line && position.character < range.end.character));

const navigationItems = (
  value: Location | readonly Location[] | readonly LocationLink[] | null,
): readonly (Location | LocationLink)[] =>
  !value ? [] : Array.isArray(value) ? value : [value as Location | LocationLink];

const locate = (item: Location | LocationLink): Located =>
  "targetUri" in item
    ? {
        uri: item.targetUri,
        range: item.targetRange,
        selectionRange: item.targetSelectionRange,
      }
    : { uri: item.uri, range: item.range, selectionRange: item.range };

const key = ({ uri, selectionRange }: Located) => `${uri}\0${rangeText(selectionRange)}`;

/** First occurrence of each key, in order, computing every key once. */
const unique = <Item>(items: readonly Item[], itemKey: (item: Item) => string) => [
  ...new Map(items.map((item) => [itemKey(item), item] as const).reverse()).values(),
].reverse();

/** Grouped by file in first-seen order, in one pass rather than a filter per uri. */
const groups = <Item extends { readonly uri: string }>(items: readonly Item[]) =>
  [...Map.groupBy(items, ({ uri }) => uri)].map(([uri, grouped]) => ({ uri, items: grouped }));

const locationText = ({ range, selectionRange }: Located) => {
  const selection = rangeText(selectionRange);
  const body = rangeText(range);
  return `selection ${selection}${body === selection ? "" : ` · body ${body}`}`;
};

const locationGroups = (items: readonly Located[], root: string) =>
  groups(items).flatMap(({ uri, items: related }) => [
    workspacePath(uri, root),
    ...related.map(
      (item) => `  ${locationText(item)}${item.sourceLine ? `  ${item.sourceLine.trim()}` : ""}`,
    ),
  ]);

const callGroups = (calls: readonly RelatedCall[], root: string, sharedSiteUri?: string) =>
  groups(calls.map((call) => ({ ...call, uri: call.item.uri }))).flatMap(({ uri, items }) => [
    workspacePath(uri, root),
    ...items.map(({ item, siteUri, sites }) => {
      const selection = rangeText(item.selectionRange);
      const body = rangeText(item.range);
      const callSites = sites.map(rangeText).join(", ");
      const bodyLocation = body === selection ? "" : ` · body ${body}`;
      const location =
        item.kind === SymbolKind.Module ? "" : ` selection ${selection}${bodyLocation}`;
      return `  ${item.name} [${symbolKind(item.kind)}]${location} · calls ${
        siteUri === sharedSiteUri || siteUri === item.uri
          ? callSites
          : `${workspacePath(siteUri, root)}:${callSites}`
      }${item.detail && item.kind !== SymbolKind.Module ? ` — ${item.detail}` : ""}`;
    }),
  ]);

const callSection = (input: {
  readonly calls: readonly RelatedCall[];
  readonly includeExternalDetails?: boolean;
  readonly limit: number;
  readonly name: string;
  readonly root: string;
  readonly sharedSiteUri?: string;
}) => {
  const classified = input.calls.map((call) => {
    const uri = URI.parse(call.item.uri);
    return {
      call,
      external: !isFileInDir(uri.fsPath, input.root) || uri.path.includes("/node_modules/"),
    };
  });
  const external = input.includeExternalDetails
    ? []
    : classified.filter(({ external }) => external).map(({ call }) => call);
  const calls = input.includeExternalDetails
    ? input.calls
    : classified.filter(({ external }) => !external).map(({ call }) => call);
  const shown = calls.slice(0, input.limit);
  const externalNames = [...new Set(external.map(({ item }) => item.name))];
  if (!shown.length && !external.length) return [];
  const shownCount =
    shown.length === calls.length ? `${calls.length}` : `${shown.length}/${calls.length}`;
  const count = input.includeExternalDetails
    ? shownCount
    : `${shownCount} workspace${external.length ? ` · ${external.length} dependency/runtime` : ""}`;
  return [
    `${input.name} (${count})${
      input.sharedSiteUri
        ? ` · call sites in ${workspacePath(input.sharedSiteUri, input.root)}`
        : ""
    }`,
    ...callGroups(shown, input.root, input.sharedSiteUri),
    ...(shown.length < calls.length ? [`${calls.length - shown.length} more`] : []),
    ...(external.length
      ? [
          `Dependency/runtime: ${externalNames.slice(0, input.limit).join(", ")}${
            externalNames.length > input.limit
              ? ` · ${externalNames.length - input.limit} more`
              : ""
          }`,
        ]
      : []),
  ];
};

const symbolChoice = (
  status: "ambiguous" | "not found",
  symbol: string,
  fileUri: string,
  candidates: readonly Located[],
  total: number,
  root: string,
) => {
  return [
    `Symbol "${symbol}" is ${status} · ${workspacePath(fileUri, root)}`,
    ...(candidates.length
      ? [
          `Candidates (${candidates.length === total ? candidates.length : `${candidates.length}/${total}`})`,
          ...candidates.map(
            (candidate) =>
              `  ${candidate.name} [${symbolKind(candidate.kind!)}] ${locationText(
                candidate,
              )}${candidate.detail ? ` — ${candidate.detail}` : ""}${
                candidate.sourceLine ? `  ${candidate.sourceLine.trim()}` : ""
              }`,
          ),
          ...(candidates.length < total ? [`${total - candidates.length} more`] : []),
        ]
      : []),
  ].join("\n");
};

const documentLines = async (workspace: VolarWorkspace, uri: string) =>
  sourceLines((await workspace.readTextDocumentUri(uri)).source);

const excerpt = async (workspace: VolarWorkspace, target: Located) => {
  const lines = await documentLines(workspace, target.uri);
  const end = target.range.end.line + (target.range.end.character > 0 ? 1 : 0);
  return lines
    .slice(target.range.start.line, end)
    .map((line, index) => `${target.range.start.line + index + 1}|${line}`);
};

const withSourceLines = async (workspace: VolarWorkspace, items: readonly Located[]) =>
  (
    await Promise.all(
      groups(items).map(async ({ uri, items: related }) => {
        const lines = await documentLines(workspace, uri);
        return related.map((item) => ({
          ...item,
          sourceLine: lines[item.selectionRange.start.line] ?? "",
        }));
      }),
    )
  ).flat();

/**
 * One document's declarations, from its text.
 *
 * An outline is syntactic — the language server answers it from a parse of this
 * one file — but a request for it resolves to the project owning the file first
 * and builds that project's program. This inspection wants an outline three
 * times over: to resolve a name, to find what a position sits inside, and to
 * name a definition in another file. None of them are worth a program.
 */
const outline = async (workspace: VolarWorkspace, uri: string) =>
  documentSymbols({ uri, source: (await workspace.readTextDocumentUri(uri)).source });

/**
 * The declaration a definition points at, in whichever file that is.
 *
 * A definition and the outline entry for it agree on their selection range, so
 * the two are matched. The document under inspection is already outlined; only
 * a definition in another file is read, and only inside the workspace.
 */
const declarationAt = async (input: {
  readonly workspace: VolarWorkspace;
  readonly root: string;
  readonly document: { readonly uri: string };
  readonly symbols: readonly DocumentSymbol[];
  readonly definition: Located | undefined;
}) => {
  const { definition } = input;
  if (!definition) return undefined;
  const local = definition.uri === input.document.uri;
  if (!local && !isFileInDir(URI.parse(definition.uri).fsPath, input.root)) return undefined;
  const symbols = local ? input.symbols : await outline(input.workspace, definition.uri);
  const wanted = key(definition);
  for (const symbol of declarations(symbols, definition.uri)) {
    if (key(symbol) === wanted) return symbol;
  }
  return undefined;
};

/**
 * Composes the language server's symbol, hover, navigation, reference, and call
 * hierarchy results into one bounded inspection.
 *
 * Name selection is exact within the requested document and reports ambiguity
 * rather than choosing a declaration. Position selection follows the language
 * server's normal resolution rules.
 */
export const inspectSymbol = async (input: {
  readonly workspace: VolarWorkspace;
  readonly root: string;
  readonly file: string;
  readonly target: InspectSymbolTarget;
  readonly options: InspectSymbolOptions;
  readonly signal: AbortSignal;
}): Promise<InspectSymbolResult> => {
  const { workspace, root, file, target, options, signal } = input;
  const textDocument = await workspace.getTextDocument(file);
  // Read and parsed here rather than asked of the language server, so resolving
  // a name never waits on a project. It answers two questions — which
  // declaration a name means, and what declaration a position falls in — from
  // one parse.
  const fileSymbols = await outline(workspace, textDocument.uri);
  // Walked once, keeping only what a name asked for. A position needs no walk.
  const matches =
    "symbol" in target
      ? [...declarations(fileSymbols, textDocument.uri)].filter(
          ({ name }) => name === target.symbol,
        )
      : [];
  if ("symbol" in target && matches.length !== 1) {
    const wanted = target.symbol.toLowerCase();
    const candidates = matches.length
      ? matches
      : [...declarations(fileSymbols, textDocument.uri)].filter(({ name }) =>
          name?.toLowerCase().includes(wanted),
        );
    const shownCandidates = await withSourceLines(workspace, candidates.slice(0, options.limit));
    return {
      textDocument,
      choice: {
        reason: matches.length ? "ambiguous" : "not found",
        name: target.symbol,
        candidates: shownCandidates,
        total: candidates.length,
      },
    };
  }

  const selected = "symbol" in target ? matches[0]! : undefined;
  const position = "position" in target ? target.position : selected!.selectionRange.start;
  const [project, hover, definitionResult, implementationResult, references, items] =
    await Promise.all([
      workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
      workspace.sendRequest(HoverRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(DefinitionRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(ImplementationRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(
        ReferencesRequest.type,
        {
          textDocument,
          position,
          context: { includeDeclaration: true },
          crossProject: options.crossProject,
        } as ReferenceParams & { readonly crossProject?: boolean },
        signal,
      ),
      workspace.sendRequest(CallHierarchyPrepareRequest.type, { textDocument, position }, signal),
    ]);
  const [incoming, outgoing] = await Promise.all([
    items
      ? Promise.all(
          items.map((item) =>
            workspace.sendRequest(CallHierarchyIncomingCallsRequest.type, { item }, signal),
          ),
        )
      : null,
    items
      ? Promise.all(
          items.map((item) =>
            workspace.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item }, signal),
          ),
        )
      : null,
  ]);
  const definitions = navigationItems(definitionResult).map(locate);
  const implementations = navigationItems(implementationResult).map(locate);
  const callable = items?.[0];
  // A name target already chose its declaration, and a callable carries its own
  // identity from the call hierarchy. Everything else is a position in a file:
  // the declaration its definition points at, or failing that the one it sits
  // inside.
  const unnamed =
    selected || callable
      ? undefined
      : ((await declarationAt({
          workspace,
          root,
          document: textDocument,
          symbols: fileSymbols,
          definition: definitions[0],
        })) ??
        enclosing({ symbols: fileSymbols, position, uri: textDocument.uri }));
  const base: Located =
    selected ??
    unnamed ??
    (callable
      ? {
          uri: callable.uri,
          name: callable.name,
          kind: callable.kind,
          range: callable.range,
          selectionRange: callable.selectionRange,
          ...(callable.detail ? { detail: callable.detail } : {}),
        }
      : (definitions[0] ?? {
          uri: textDocument.uri,
          range: { start: position, end: position },
          selectionRange: { start: position, end: position },
        }));
  const declaration = definitions.find((definition) => key(definition) === key(base));
  const primary: Located = {
    ...base,
    ...(callable
      ? {
          name: callable.name,
          kind: callable.kind,
          ...(callable.detail ? { detail: callable.detail } : {}),
        }
      : {}),
    ...(declaration
      ? { range: declaration.range, selectionRange: declaration.selectionRange }
      : {}),
  };
  const [source, typeResult] = await Promise.all([
    options.includeSource ? excerpt(workspace, primary) : undefined,
    options.includeTypeDefinitions
      ? workspace.sendRequest(TypeDefinitionRequest.type, { textDocument, position }, signal)
      : null,
  ]);
  const typeDefinitions = navigationItems(typeResult).map(locate);
  const callers = unique(
    incoming?.flatMap(
      (calls) =>
        calls?.map((call) => ({
          item: call.from,
          siteUri: call.from.uri,
          sites: unique(call.fromRanges, rangeText),
        })) ?? [],
    ) ?? [],
    ({ item, siteUri, sites }) => `${key(item)}\0${siteUri}\0${sites.map(rangeText).join(",")}`,
  );
  const callees = unique(
    outgoing?.flatMap(
      (calls, index) =>
        calls?.map((call) => ({
          item: call.to,
          siteUri: items?.[index]?.uri ?? textDocument.uri,
          sites: unique(call.fromRanges, rangeText),
        })) ?? [],
    ) ?? [],
    ({ item, siteUri, sites }) => `${key(item)}\0${siteUri}\0${sites.map(rangeText).join(",")}`,
  );
  const represented = new Set([
    key(primary),
    ...definitions.map(key),
    ...implementations.map(key),
    ...callers.flatMap(({ siteUri, sites }) =>
      sites.map((range) => key({ uri: siteUri, range, selectionRange: range })),
    ),
  ]);
  const allReferences =
    references?.map(({ uri, range }) => ({ uri, range, selectionRange: range })) ?? [];
  const otherReferences = allReferences.filter((reference) => !represented.has(key(reference)));
  const shownReferences = await withSourceLines(workspace, otherReferences.slice(0, options.limit));
  const extras = (items: readonly Located[]) => items.filter((item) => key(item) !== key(primary));
  const additionalDefinitions = extras(definitions);
  const distinctImplementations = extras(implementations).filter(
    (item) => !definitions.some((definition) => key(definition) === key(item)),
  );
  const distinctTypes = extras(typeDefinitions).filter(
    (item) =>
      !definitions.some((definition) => key(definition) === key(item)) &&
      !implementations.some((implementation) => key(implementation) === key(item)),
  );
  const siteUris = [...new Set(callees.map(({ siteUri }) => siteUri))];
  const sharedSiteUri = siteUris.length === 1 ? siteUris[0] : undefined;
  const name = primary.name ?? ("symbol" in target ? target.symbol : "Symbol");
  const hoverText = hover ? hoverContentsText(hover.contents) : undefined;

  return {
    textDocument,
    position,
    primary,
    name,
    project: project ? project.uri : undefined,
    hover: hoverText,
    additionalDefinitions,
    implementations: distinctImplementations,
    typeDefinitions: distinctTypes,
    callers: items?.length ? callers : [],
    callees: items?.length ? callees : [],
    sharedCalleeUri: sharedSiteUri,
    compactExternalCalls: options.compactExternalCalls,
    limit: options.limit,
    references: {
      shown: shownReferences,
      other: otherReferences.length,
      total: allReferences.length,
    },
    source,
  };
};

/** Renders an inspection as the agent-facing text the MCP returns. */
export const formatSymbolInspection = (input: {
  readonly result: InspectSymbolResult;
  readonly root: string;
}): string => {
  const { result, root } = input;
  if (result.choice) {
    return symbolChoice(
      result.choice.reason,
      result.choice.name,
      result.textDocument.uri,
      result.choice.candidates,
      result.choice.total,
      root,
    );
  }
  const primary = result.primary;
  if (!primary) return "";
  const additionalDefinitions = result.additionalDefinitions ?? [];
  const distinctImplementations = result.implementations ?? [];
  const distinctTypes = result.typeDefinitions ?? [];
  const callers = result.callers ?? [];
  const callees = result.callees ?? [];
  const shownReferences = result.references?.shown ?? [];
  const otherReferences = result.references?.other ?? 0;
  const allReferences = result.references?.total ?? 0;
  const limit = result.limit ?? shownReferences.length;
  return [
      `${result.name}${primary.kind === undefined ? "" : ` [${symbolKind(primary.kind)}]`}`,
      workspacePath(primary.uri, root),
      `  ${locationText(primary)}`,
      `  project ${result.project ? workspacePath(result.project, root) : "inferred"}`,
      ...(result.hover ? ["", result.hover] : []),
      ...(additionalDefinitions.length
        ? [
            "",
            `Additional definitions (${additionalDefinitions.length})`,
            ...locationGroups(additionalDefinitions, root),
          ]
        : []),
      ...(distinctImplementations.length
        ? [
            "",
            `Implementations (${distinctImplementations.length})`,
            ...locationGroups(distinctImplementations, root),
          ]
        : []),
      ...(distinctTypes.length
        ? ["", `Type definitions (${distinctTypes.length})`, ...locationGroups(distinctTypes, root)]
        : []),
      ...(callers.length
        ? [
            "",
            ...callSection({
              name: "Callers",
              calls: callers,
              limit,
              root,
              includeExternalDetails: true,
            }),
          ]
        : []),
      ...(callees.length
        ? [
            "",
            ...callSection({
              name: "Calls",
              calls: callees,
              limit,
              root,
              sharedSiteUri: result.sharedCalleeUri,
              includeExternalDetails: result.compactExternalCalls === false,
            }),
          ]
        : []),
      ...(otherReferences
        ? [
            "",
            `Other references (${
              shownReferences.length === otherReferences
                ? `${otherReferences} of ${allReferences} total`
                : `${shownReferences.length}/${otherReferences} other · ${allReferences} total`
            })`,
            ...locationGroups(shownReferences, root),
            ...(shownReferences.length < otherReferences
              ? [`${otherReferences - shownReferences.length} more`]
              : []),
          ]
        : []),
      ...(result.source
        ? [
            "",
            `Source · ${workspacePath(primary.uri, root)}:${rangeText(primary.range)}`,
            ...result.source,
          ]
        : []),
  ].join("\n");
};
