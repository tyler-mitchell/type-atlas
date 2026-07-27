import {
  CallHierarchyIncomingCallsRequest,
  type CallHierarchyItem,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  DocumentSymbolRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  type Location,
  type LocationLink,
  type Position,
  type Range,
  ReferencesRequest,
  type SymbolInformation,
  type DocumentSymbol,
  TypeDefinitionRequest,
} from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import { URI } from "vscode-uri";
import { hoverContentsText, rangeText, symbolKind, workspacePath } from "./plain-text.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

/** Selects either an exact document-symbol name or an LSP source position. */
export type InspectSymbolTarget = { readonly position: Position } | { readonly symbol: string };

/** Controls expensive source and type sections and bounds repeated relationships. */
export type InspectSymbolOptions = {
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

/**
 * The canonical agent-facing inspection and the resolved position used to produce it.
 *
 * `position` is absent when a name is ambiguous or cannot be resolved; `text`
 * then contains bounded candidates with exact source ranges.
 */
export type InspectSymbolResult = {
  readonly textDocument: { readonly uri: string };
  readonly position?: Position;
  readonly text: string;
};

const flattenSymbols = (
  symbols: readonly (DocumentSymbol | SymbolInformation)[] | null,
  documentUri: string,
): readonly Located[] =>
  symbols?.flatMap((symbol): readonly Located[] =>
    "range" in symbol
      ? [
          {
            uri: documentUri,
            name: symbol.name,
            kind: symbol.kind,
            range: symbol.range,
            selectionRange: symbol.selectionRange,
            ...(symbol.detail ? { detail: symbol.detail } : {}),
          },
          ...flattenSymbols(symbol.children ?? null, documentUri),
        ]
      : [
          {
            uri: symbol.location.uri,
            name: symbol.name,
            kind: symbol.kind,
            range: symbol.location.range,
            selectionRange: symbol.location.range,
            ...(symbol.containerName ? { detail: symbol.containerName } : {}),
          },
        ],
  ) ?? [];

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

const unique = <Item>(items: readonly Item[], itemKey: (item: Item) => string) =>
  items.filter(
    (item, index) => items.findIndex((candidate) => itemKey(candidate) === itemKey(item)) === index,
  );

const groups = <Item extends { readonly uri: string }>(items: readonly Item[]) =>
  [...new Set(items.map(({ uri }) => uri))].map((uri) => ({
    uri,
    items: items.filter((item) => item.uri === uri),
  }));

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
      return `  ${item.name} [${symbolKind(item.kind)}] selection ${selection}${
        body === selection ? "" : ` · body ${body}`
      } · calls ${
        siteUri === sharedSiteUri || siteUri === item.uri
          ? callSites
          : `${workspacePath(siteUri, root)}:${callSites}`
      }${item.detail ? ` — ${item.detail}` : ""}`;
    }),
  ]);

const callSection = (
  name: string,
  calls: readonly RelatedCall[],
  limit: number,
  root: string,
  sharedSiteUri?: string,
) => {
  const shown = calls.slice(0, limit);
  return [
    `${name} (${shown.length === calls.length ? calls.length : `${shown.length}/${calls.length}`})${
      sharedSiteUri ? ` · call sites in ${workspacePath(sharedSiteUri, root)}` : ""
    }`,
    ...callGroups(shown, root, sharedSiteUri),
    ...(shown.length < calls.length ? [`${calls.length - shown.length} more`] : []),
  ];
};

const symbolChoice = (
  status: "ambiguous" | "not found",
  symbol: string,
  fileUri: string,
  candidates: readonly Located[],
  root: string,
  limit: number,
) => {
  const shown = candidates.slice(0, limit);
  return [
    `Symbol "${symbol}" is ${status} · ${workspacePath(fileUri, root)}`,
    ...(shown.length
      ? [
          `Candidates (${shown.length === candidates.length ? shown.length : `${shown.length}/${candidates.length}`})`,
          ...shown.map(
            (candidate) =>
              `  ${candidate.name} [${symbolKind(candidate.kind!)}] ${locationText(
                candidate,
              )}${candidate.detail ? ` — ${candidate.detail}` : ""}`,
          ),
          ...(shown.length < candidates.length ? [`${candidates.length - shown.length} more`] : []),
        ]
      : []),
  ].join("\n");
};

const sourceLines = async (workspace: VolarWorkspace, uri: string) =>
  (await workspace.readTextDocumentUri(uri)).source.split(/\r?\n/);

const excerpt = async (workspace: VolarWorkspace, target: Located) => {
  const lines = await sourceLines(workspace, target.uri);
  const end = target.range.end.line + (target.range.end.character > 0 ? 1 : 0);
  return lines
    .slice(target.range.start.line, end)
    .map((line, index) => `${target.range.start.line + index + 1}|${line}`);
};

const withSourceLines = async (workspace: VolarWorkspace, items: readonly Located[]) =>
  (
    await Promise.all(
      groups(items).map(async ({ uri, items: related }) => {
        const lines = await sourceLines(workspace, uri);
        return related.map((item) => ({
          ...item,
          sourceLine: lines[item.selectionRange.start.line] ?? "",
        }));
      }),
    )
  ).flat();

const symbolAtDefinition = async (
  workspace: VolarWorkspace,
  root: string,
  definition: Located | undefined,
  signal: AbortSignal,
) => {
  if (!definition) return undefined;
  const file = URI.parse(definition.uri).fsPath;
  if (!isFileInDir(file, root)) return undefined;
  const textDocument = await workspace.getTextDocument(file);
  const symbols = await workspace.sendRequest(DocumentSymbolRequest.type, { textDocument }, signal);
  return flattenSymbols(symbols, definition.uri).find((symbol) => key(symbol) === key(definition));
};

const enclosingSymbolAt = async (
  workspace: VolarWorkspace,
  textDocument: { readonly uri: string },
  position: Position,
  signal: AbortSignal,
) =>
  flattenSymbols(
    await workspace.sendRequest(DocumentSymbolRequest.type, { textDocument }, signal),
    textDocument.uri,
  )
    .filter(
      ({ range }) =>
        (range.start.line < position.line ||
          (range.start.line === position.line && range.start.character <= position.character)) &&
        (position.line < range.end.line ||
          (position.line === range.end.line && position.character < range.end.character)),
    )
    .sort(
      (left, right) =>
        right.range.start.line - left.range.start.line ||
        right.range.start.character - left.range.start.character ||
        left.range.end.line - right.range.end.line ||
        left.range.end.character - right.range.end.character,
    )[0];

/**
 * Composes the language server's symbol, hover, navigation, reference, and call
 * hierarchy results into one bounded inspection.
 *
 * Name selection is exact within the requested document and reports ambiguity
 * rather than choosing a declaration. Position selection follows the language
 * server's normal resolution rules.
 */
export const inspectSymbol = async (
  workspace: VolarWorkspace,
  root: string,
  file: string,
  target: InspectSymbolTarget,
  options: InspectSymbolOptions,
  signal: AbortSignal,
): Promise<InspectSymbolResult> => {
  const textDocument = await workspace.getTextDocument(file);
  const symbols =
    "symbol" in target
      ? flattenSymbols(
          await workspace.sendRequest(DocumentSymbolRequest.type, { textDocument }, signal),
          textDocument.uri,
        )
      : [];
  const matches = "symbol" in target ? symbols.filter(({ name }) => name === target.symbol) : [];
  if ("symbol" in target && matches.length !== 1) {
    const candidates = matches.length
      ? matches
      : symbols.filter(({ name }) => name?.toLowerCase().includes(target.symbol.toLowerCase()));
    return {
      textDocument,
      text: symbolChoice(
        matches.length ? "ambiguous" : "not found",
        target.symbol,
        textDocument.uri,
        candidates,
        root,
        options.limit,
      ),
    };
  }

  const selected = "symbol" in target ? matches[0]! : undefined;
  const position = "position" in target ? target.position : selected!.selectionRange.start;
  const [project, hover, definitionResult, implementationResult, references, hierarchy] =
    await Promise.all([
      workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
      workspace.sendRequest(HoverRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(DefinitionRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(ImplementationRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(
        ReferencesRequest.type,
        { textDocument, position, context: { includeDeclaration: true } },
        signal,
      ),
      workspace.runResolverSequence(async () => {
        const items = await workspace.sendRequest(
          CallHierarchyPrepareRequest.type,
          { textDocument, position },
          signal,
        );
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
        return { items, incoming, outgoing };
      }, signal),
    ]);
  const { items, incoming, outgoing } = hierarchy;
  const definitions = navigationItems(definitionResult).map(locate);
  const implementations = navigationItems(implementationResult).map(locate);
  const callable = items?.[0];
  const definedSymbol =
    !selected && !callable
      ? await symbolAtDefinition(workspace, root, definitions[0], signal)
      : undefined;
  const enclosingSymbol =
    !selected && !callable && !definedSymbol
      ? await enclosingSymbolAt(workspace, textDocument, position, signal)
      : undefined;
  const base: Located =
    selected ??
    definedSymbol ??
    enclosingSymbol ??
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
    options.includeTypeDefinitions || !items?.length
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
    text: [
      `${name}${primary.kind === undefined ? "" : ` [${symbolKind(primary.kind)}]`}`,
      workspacePath(primary.uri, root),
      `  ${locationText(primary)}`,
      `  project ${project ? workspacePath(project.uri, root) : "inferred"}`,
      ...(hoverText ? ["", hoverText] : []),
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
      ...((options.includeTypeDefinitions || !items?.length) && distinctTypes.length
        ? ["", `Type definitions (${distinctTypes.length})`, ...locationGroups(distinctTypes, root)]
        : []),
      ...(items?.length
        ? [
            "",
            ...callSection("Callers", callers, options.limit, root),
            "",
            ...callSection("Calls", callees, options.limit, root, sharedSiteUri),
          ]
        : ["", "Call hierarchy: not applicable"]),
      "",
      `Other references (${
        shownReferences.length === otherReferences.length
          ? `${otherReferences.length} of ${allReferences.length} total`
          : `${shownReferences.length}/${otherReferences.length} other · ${allReferences.length} total`
      })`,
      ...locationGroups(shownReferences, root),
      ...(shownReferences.length < otherReferences.length
        ? [`${otherReferences.length - shownReferences.length} more`]
        : []),
      ...(source
        ? [
            "",
            `Source · ${workspacePath(primary.uri, root)}:${rangeText(primary.range)}`,
            ...source,
          ]
        : []),
    ].join("\n"),
  };
};
